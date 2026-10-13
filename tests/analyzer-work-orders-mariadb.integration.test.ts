import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB analyzer work order claims are CAS-idempotent and old leases cannot acknowledge", {timeout:30000},async()=>{
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const conf={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [db,a,b]=await Promise.all([mysql.createConnection(conf),mysql.createConnection(conf),mysql.createConnection(conf)]);
  const org=randomUUID(),branch=randomUUID(),patient=randomUUID(),user=randomUUID(),order=randomUUID(),testId=randomUUID(),item=randomUUID(),specimen=randomUUID(),analyzer=randomUUID(),workOrder=randomUUID(),event=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{sql:string;params:string[]}>=[];

  async function insert(sql:string,params:string[],undo:string,keys:string[]) {
    await db.execute(sql,params);
    cleanup.unshift({sql:undo,params:keys});
  }

  try {
    await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",[org,"AW-"+suffix,"Analyzer Work CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",[branch,org,"AW-"+suffix,"Analyzer Branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",[user,org,"aw-"+suffix,"Bridge Tester"],"DELETE FROM users WHERE id=?",[user]);
    await insert("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",[patient,org,"AW-"+suffix,"Bridge Patient","bridge patient"],"DELETE FROM patients WHERE id=?",[patient]);
    await insert("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",[order,org,"AW-"+suffix,branch,patient,user],"DELETE FROM orders WHERE id=?",[order]);
    await insert("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",[testId,org,"AW-"+suffix,"Analyzer Test"],"DELETE FROM lab_tests WHERE id=?",[testId]);
    await insert("INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",[item,order,testId,"AW-"+suffix,"Analyzer Test"],"DELETE FROM order_items WHERE id=?",[item]);
    await insert("INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES (?,?,?,?,1,'IN_PROCESS',?,NOW(3))",[specimen,org,order,"ABAR-"+suffix,branch],"DELETE FROM specimens WHERE id=?",[specimen]);
    await insert("INSERT INTO analyzers(id,organization_id,branch_id,code,name,protocol,transport,bridge_device_key,updated_at) VALUES (?,?,?,?,?,'ASTM','TCP_CLIENT',?,NOW(3))",[analyzer,org,branch,"AW-"+suffix,"CI Analyzer","bridge-"+suffix],"DELETE FROM analyzers WHERE id=?",[analyzer]);
    await insert(`INSERT INTO analyzer_work_orders
      (id,organization_id,branch_id,analyzer_id,order_item_id,specimen_id,assignment_event_id,
       accession_number_snapshot,barcode_snapshot,test_code_snapshot,analyzer_test_code_snapshot,
       bridge_device_key_snapshot,status,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'QUEUED',NOW(3))`,
      [workOrder,org,branch,analyzer,item,specimen,event,"AW-"+suffix,"ABAR-"+suffix,"AW-"+suffix,"A-"+suffix,"bridge-"+suffix],
      "DELETE FROM analyzer_work_orders WHERE id=?",[workOrder]);

    const [initial]=await db.execute<mysql.RowDataPacket[]>("SELECT status,attempt_count,updated_at FROM analyzer_work_orders WHERE id=?",[workOrder]);
    assert.equal(initial[0]?.status,"QUEUED");
    const revision=initial[0].updated_at as Date;
    const leaseOne=randomBytes(32).toString("hex"),hashOne=createHash("sha256").update(leaseOne).digest("hex");

    await a.beginTransaction();
    const [spec]=await a.execute<mysql.RowDataPacket[]>("SELECT id,status,current_branch_id FROM specimens WHERE id=? FOR UPDATE",[specimen]);
    assert.equal(spec[0]?.status,"IN_PROCESS");
    await b.query("SET SESSION innodb_lock_wait_timeout = 1");
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM specimens WHERE id=? FOR UPDATE",[specimen]),(e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await b.rollback();

    const [claimOne]=await a.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='CLAIMED',attempt_count=attempt_count+1,claim_token_hash=?,lease_expires_at=DATE_ADD(NOW(3), INTERVAL 2 MINUTE),updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=? AND status='QUEUED' AND attempt_count=0 AND updated_at=?",
      [hashOne,workOrder,revision]);
    assert.equal(claimOne.affectedRows,1);
    await a.commit();

    const [dupe]=await b.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='CLAIMED',attempt_count=attempt_count+1 WHERE id=? AND status='QUEUED' AND updated_at=?",[workOrder,revision]);
    assert.equal(dupe.affectedRows,0);

    const leaseTwo=randomBytes(32).toString("hex"),hashTwo=createHash("sha256").update(leaseTwo).digest("hex");
    const [reclaimed]=await b.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='CLAIMED',attempt_count=attempt_count+1,claim_token_hash=?,updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=? AND status='CLAIMED' AND claim_token_hash=?",
      [hashTwo,workOrder,hashOne]);
    assert.equal(reclaimed.affectedRows,1);
    const [staleAck]=await a.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='ACKNOWLEDGED' WHERE id=? AND status='CLAIMED' AND claim_token_hash=?",[workOrder,hashOne]);
    assert.equal(staleAck.affectedRows,0);

    const wire="MSH|^~\\\\&|CI|LAB|DEVICE|LAB|20261013||OML^O21|TEST|P|2.5\\r";
    const fingerprint=createHash("sha256").update(JSON.stringify(["ACCEPTED","",wire])).digest("hex");
    const [accepted]=await b.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='ACKNOWLEDGED',claim_token_hash=NULL,lease_expires_at=NULL,last_ack_token_hash=?,last_ack_fingerprint=?,acknowledged_at=NOW(3) WHERE id=? AND status='CLAIMED' AND claim_token_hash=?",
      [hashTwo,fingerprint,workOrder,hashTwo]);
    assert.equal(accepted.affectedRows,1);
    const [final]=await db.execute<mysql.RowDataPacket[]>("SELECT status,attempt_count,claim_token_hash,acknowledged_at,last_ack_token_hash,last_ack_fingerprint FROM analyzer_work_orders WHERE id=?",[workOrder]);
    assert.equal(final[0]?.status,"ACKNOWLEDGED");
    assert.equal(final[0]?.attempt_count,2);
    assert.equal(final[0]?.claim_token_hash,null);
    assert.ok(final[0]?.acknowledged_at);
    assert.equal(final[0]?.last_ack_token_hash,hashTwo);
    assert.equal(final[0]?.last_ack_fingerprint,fingerprint);
    const [identicalReplay]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM analyzer_work_orders WHERE id=? AND status='ACKNOWLEDGED' AND last_ack_token_hash=? AND last_ack_fingerprint=?",
      [workOrder,hashTwo,fingerprint]);
    assert.equal(identicalReplay.length,1);
    for(const [tokenHash,payloadHash] of [
      [hashOne,fingerprint],
      [hashTwo,createHash("sha256").update(JSON.stringify(["ACCEPTED","","different-wire"])).digest("hex")],
      [hashTwo,createHash("sha256").update(JSON.stringify(["REJECTED","",wire])).digest("hex")],
    ]){
      const [rejected]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM analyzer_work_orders WHERE id=? AND last_ack_token_hash=? AND last_ack_fingerprint=?",
        [workOrder,tokenHash,payloadHash]);
      assert.equal(rejected.length,0);
    }
    // After a newer claim, the old fingerprint alone must never authorize a
    // replay. Any acknowledgement on an expired new lease is also rejected.
    const leaseThree=randomBytes(32).toString("hex"),hashThree=createHash("sha256").update(leaseThree).digest("hex");
    await db.execute("UPDATE analyzer_work_orders SET status='CLAIMED',claim_token_hash=?,lease_expires_at=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?",
      [hashThree,workOrder]);
    const [expired]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_work_orders SET status='ACKNOWLEDGED' WHERE id=? AND status='CLAIMED' AND claim_token_hash=? AND lease_expires_at>NOW(3)",
      [workOrder,hashThree]);
    assert.equal(expired.affectedRows,0);
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for(const row of cleanup) await db.execute(row.sql,row.params);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
