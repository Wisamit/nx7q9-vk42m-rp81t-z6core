import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import mysql from "mysql2/promise";
test("Stage 128: real MariaDB two-session provider receipt and HL7 ACK CAS", {timeout:60000}, async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL),settings={host:u.hostname,port:Number(u.port||3306),
   user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const [db,a,b]=await Promise.all([mysql.createConnection(settings),mysql.createConnection(settings),mysql.createConnection(settings)]);
 const org=randomUUID(),other=randomUUID(),branch=randomUUID(),actor=randomUUID(),endpoint=randomUUID(),
   note=randomUUID(),delivery=randomUUID(),message=randomUUID(),suffix=org.slice(0,8);
 const cleanup:Array<[string,string]>=[];
 async function put(table:string,id:string,sql:string,values:(string|number)[]){
   await db.execute(sql,values);cleanup.unshift([table,id]);
 }
 const fingerprint=createHash("sha256").update("synthetic-receipt").digest("hex"),
   wrong=createHash("sha256").update("contradictory").digest("hex"),
   ackHash=createHash("sha256").update("synthetic-hl7-ack").digest("hex");
 const receiptSql="UPDATE notification_deliveries d JOIN notifications n ON n.id=d.notification_id "+
   "SET d.status='DELIVERED',d.delivered_at=NOW(3),d.receipt_fingerprint=? "+
   "WHERE d.id=? AND n.organization_id=? AND d.channel='EMAIL' AND d.provider_message_id=? "+
   "AND d.status='SENT' AND d.receipt_fingerprint IS NULL";
 const ackSql="UPDATE integration_messages SET status='ACKNOWLEDGED',ack_fingerprint=? "+
   "WHERE id=? AND organization_id=? AND endpoint_id=? AND direction='OUTBOUND' "+
   "AND status='SENT' AND attempt_count=1";
 const lockTimeout=(e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_LOCK_WAIT_TIMEOUT");
 try {
  for(const [id,letter] of [[org,"A"],[other,"B"]])
    await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"ST128"+suffix+letter,"Synthetic"]);
  await put("branches",branch,"INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [branch,org,"ST128"+suffix,"Synthetic Branch"]);
  await put("users",actor,"INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [actor,org,"st128-"+suffix,"Synthetic User"]);
  await put("integration_endpoints",endpoint,"INSERT INTO integration_endpoints(id,organization_id,branch_id,code,name,endpoint_type,direction,base_url,created_by_user_id,updated_at) "+
    "VALUES(?,?,?,?,?,'HL7_V2','OUTBOUND',?,?,NOW(3))",
    [endpoint,org,branch,"ST128"+suffix,"Synthetic Interface","https://example.org/hl7",actor]);
  await put("notifications",note,"INSERT INTO notifications(id,organization_id,branch_id,event_code,recipient_type,title,body) "+
    "VALUES(?,?,?,'STAGE128_TEST','USER','Synthetic','Not a clinical message')",[note,org,branch]);
  await put("notification_deliveries",delivery,"INSERT INTO notification_deliveries(id,notification_id,channel,destination,provider_message_id,status,updated_at) "+
    "VALUES(?,?,'EMAIL','fake@example.invalid','GATEWAY-128','SENT',NOW(3))",[delivery,note]);
  await put("integration_messages",message,"INSERT INTO integration_messages(id,organization_id,branch_id,endpoint_id,direction,message_type,control_id,payload_hash,payload_text,status,attempt_count,updated_at) "+
    "VALUES(?,?,?,?,'OUTBOUND','ORU^R01','CTRL-128',?,'MSH','SENT',1,NOW(3))",
    [message,org,branch,endpoint,"a".repeat(64)]);
  await b.query("SET SESSION innodb_lock_wait_timeout=1");
  for(const [tenant,ref] of [[other,"GATEWAY-128"],[org,"GATEWAY-WRONG"]]){
    const [result]=await db.execute<mysql.ResultSetHeader>(receiptSql,[fingerprint,delivery,tenant,ref]);
    assert.equal(result.affectedRows,0);
  }
  await a.beginTransaction();
  const [first]=await a.execute<mysql.ResultSetHeader>(receiptSql,[fingerprint,delivery,org,"GATEWAY-128"]);
  assert.equal(first.affectedRows,1);
  await b.beginTransaction();
  await assert.rejects(b.execute(receiptSql,[wrong,delivery,org,"GATEWAY-128"]),lockTimeout);
  await b.rollback();await a.commit();
  const [duplicate]=await b.execute<mysql.ResultSetHeader>(receiptSql,[wrong,delivery,org,"GATEWAY-128"]);
  assert.equal(duplicate.affectedRows,0);
  const [rows]=await db.execute<mysql.RowDataPacket[]>("SELECT status,receipt_fingerprint,delivered_at FROM notification_deliveries WHERE id=?",[delivery]);
  assert.equal(rows[0].status,"DELIVERED");assert.equal(rows[0].receipt_fingerprint,fingerprint);assert.ok(rows[0].delivered_at);
  const [foreign]=await db.execute<mysql.ResultSetHeader>(ackSql,[ackHash,message,other,endpoint]);
  assert.equal(foreign.affectedRows,0);
  await a.beginTransaction();
  const [ackFirst]=await a.execute<mysql.ResultSetHeader>(ackSql,[ackHash,message,org,endpoint]);
  assert.equal(ackFirst.affectedRows,1);
  await b.beginTransaction();
  await assert.rejects(b.execute(ackSql,[wrong,message,org,endpoint]),lockTimeout);
  await b.rollback();await a.commit();
  const [stale]=await b.execute<mysql.ResultSetHeader>(ackSql,[wrong,message,org,endpoint]);
  assert.equal(stale.affectedRows,0);
  const [ack]=await db.execute<mysql.RowDataPacket[]>("SELECT status,ack_fingerprint FROM integration_messages WHERE id=?",[message]);
  assert.equal(ack[0].status,"ACKNOWLEDGED");assert.equal(ack[0].ack_fingerprint,ackHash);
 }finally{
  await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
  for(const [table,id] of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]);
  await Promise.all([a.end(),b.end(),db.end()]);
 }
});
