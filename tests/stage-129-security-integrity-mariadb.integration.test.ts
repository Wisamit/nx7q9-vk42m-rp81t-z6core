import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 129 MariaDB: revoked key races and persisted attachment integrity remain tenant-fenced",{
  timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
   password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const [db,a,b]=await Promise.all([
   mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config)]);
 const org=randomUUID(),other=randomUUID(),branch=randomUUID(),user=randomUUID(),
   endpoint=randomUUID(),key=randomUUID(),patient=randomUUID(),attachment=randomUUID(),suffix=org.slice(0,8);
 const payload=Buffer.concat([Buffer.from("synthetic-doc:"),randomBytes(128)]);
 const sha=createHash("sha256").update(payload).digest("hex");
 const cleanup:Array<[string,string]>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|Buffer)[]){
  await db.execute(sql,args);cleanup.unshift([table,id]);
 }
 const timeout=(e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_LOCK_WAIT_TIMEOUT");
 const guardedAuth="UPDATE integration_api_keys k "+
   "JOIN integration_endpoints e ON e.id=k.endpoint_id "+
   "SET k.last_used_at=NOW(3) WHERE k.id=? AND k.organization_id=? "+
   "AND k.revoked_at IS NULL AND k.expires_at IS NULL "+
   "AND e.organization_id=? AND e.status='ACTIVE'";
 try{
  for(const [id,code] of [[org,"A"],[other,"B"]]){
   await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
     [id,"ST129"+suffix+code,"Stage129 Synthetic"]);
  }
  await put("branches",branch,"INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [branch,org,"ST129"+suffix,"Synthetic Branch"]);
  await put("users",user,"INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [user,org,"stage129-"+suffix,"Synthetic User"]);
  await put("integration_endpoints",endpoint,
    "INSERT INTO integration_endpoints(id,organization_id,branch_id,code,name,endpoint_type,direction,base_url,created_by_user_id,updated_at) "+
    "VALUES(?,?,?,?,?,'REST','OUTBOUND',?,?,NOW(3))",
    [endpoint,org,branch,"ST129"+suffix,"Synthetic Rest","https://example.org/api",user]);
  await put("integration_api_keys",key,
    "INSERT INTO integration_api_keys(id,organization_id,endpoint_id,name,key_prefix,key_hash,scopes,created_by_user_id) "+
    "VALUES(?,?,?,?,?,?,'[\"messages.read\"]',?)",
    [key,org,endpoint,"Synthetic","s129"+suffix,sha,user]);
  await put("patients",patient,
    "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
    [patient,org,"SYN-"+suffix,"Synthetic Person","synthetic person"]);
  await put("attachments",attachment,
    "INSERT INTO attachments(id,organization_id,branch_id,target_type,target_id,original_name,content_type,size_bytes,sha256,uploaded_by_user_id) "+
    "VALUES(?,?,?,'PATIENT',?,'synthetic.txt','text/plain',?,?,?)",
    [attachment,org,branch,patient,payload.length,sha,user]);
  await put("attachment_contents",attachment,
    "INSERT INTO attachment_contents(attachment_id,data) VALUES(?,?)",[attachment,payload]);
  await b.query("SET SESSION innodb_lock_wait_timeout=1");
  const [foreign]=await db.execute<mysql.ResultSetHeader>(guardedAuth,[key,other,other]);
  assert.equal(foreign.affectedRows,0,"foreign tenant cannot claim token");
  await a.beginTransaction();
  const [claimed]=await a.execute<mysql.ResultSetHeader>(guardedAuth,[key,org,org]);
  assert.equal(claimed.affectedRows,1);
  await b.beginTransaction();
  await assert.rejects(b.execute(
    "UPDATE integration_api_keys SET revoked_at=NOW(3) WHERE id=?",[key]),timeout);
  await b.rollback();await a.commit();
  await b.execute("UPDATE integration_api_keys SET revoked_at=NOW(3) WHERE id=?",[key]);
  const [stale]=await a.execute<mysql.ResultSetHeader>(guardedAuth,[key,org,org]);
  assert.equal(stale.affectedRows,0,"revoked API key cannot get renewed capability");
  const [contents]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT a.sha256,a.size_bytes,c.data FROM attachments a JOIN attachment_contents c "+
    "ON c.attachment_id=a.id WHERE a.id=? AND a.organization_id=?",[attachment,org]);
  assert.equal(contents.length,1);
  assert.equal(contents[0].size_bytes,payload.length);
  assert.equal(createHash("sha256").update(contents[0].data).digest("hex"),contents[0].sha256);
  const [leak]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT a.id FROM attachments a JOIN attachment_contents c ON c.attachment_id=a.id "+
    "WHERE a.id=? AND a.organization_id=?",[attachment,other]);
  assert.equal(leak.length,0,"cross-tenant blob metadata is inaccessible");
  // Check raw BLOB presence: full DB dump captures this table; backup script
  // must not mistake the separate evidence ledger for actual stored content.
  assert.ok(Buffer.from(contents[0].data).equals(payload));
 } finally{
  await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
  for(const [table,id] of cleanup)await db.execute("DELETE FROM "+table+" WHERE "+(
    table==="attachment_contents"?"attachment_id":"id")+"=?",[id]);
  await Promise.all([a.end(),b.end(),db.end()]);
 }
});
