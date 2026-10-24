import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Exercises MariaDB/InnoDB raw-message idempotency and clinical import locks. */
test("analyzer raw dedupe and clinical import are serialized across two database sessions", { timeout: 45000 }, async () => {
  const configured=process.env.DATABASE_URL;
  if(!configured)throw Error("DATABASE_URL required for analyzer bridge integration");
  const u=new URL(configured),settings={
    host:u.hostname,port:Number(u.port||3306),
    database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
  };
  const [setup,first,second]=await Promise.all([
    mysql.createConnection(settings),mysql.createConnection(settings),mysql.createConnection(settings),
  ]);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),patient=randomUUID();
  const testId=randomUUID(),order=randomUUID(),orderItem=randomUUID(),specimen=randomUUID();
  const analyzer=randomUUID(),message=randomUUID(),importId=randomUUID(),result=randomUUID();
  const suffix=org.slice(0,8);
  const raw="MSH|^~\\&|LAB|INSTRUMENT|LIS|LAB|20261008||ORU^R01|MSG-1|P|2.5\rOBR|1||BAR-1\r";
  const hash=createHash("sha256").update(raw,"utf8").digest("hex");
  const cleanup: Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],undo:string,undoArgs:string[]){
    await setup.execute(sql,args);
    cleanup.unshift({sql:undo,args:undoArgs});
  }
  try{
    await seed("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"AN-"+suffix,"Analyzer Bridge CI"],"DELETE FROM organizations WHERE id = ?",[org]);
    await seed("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"AN-"+suffix,"Analyzer CI Branch"],"DELETE FROM branches WHERE id = ?",[branch]);
    await seed("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"an-"+suffix,"Bridge Reviewer"],"DELETE FROM users WHERE id = ?",[user]);
    await seed("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"AN-"+suffix,"Analyzer Patient","analyzer patient"],"DELETE FROM patients WHERE id = ?",[patient]);
    await seed("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"AN-"+suffix,branch,patient,user],"DELETE FROM orders WHERE id = ?",[order]);
    await seed("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"AN-"+suffix,"Test"],"DELETE FROM lab_tests WHERE id = ?",[testId]);
    await seed("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [orderItem,order,testId,"AN-"+suffix,"Test"],"DELETE FROM order_items WHERE id = ?",[orderItem]);
    await seed("INSERT INTO specimens (id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES (?,?,?,?,1,'IN_PROCESS',?,NOW(3))",
      [specimen,org,order,"AN-BAR-"+suffix,branch],"DELETE FROM specimens WHERE id = ?",[specimen]);
    await seed("INSERT INTO analyzers (id,organization_id,branch_id,code,name,protocol,transport,updated_at) VALUES (?,?,?,?,?,'HL7_V2','TCP_SERVER',NOW(3))",
      [analyzer,org,branch,"AN-"+suffix,"Analyzer CI"],"DELETE FROM analyzers WHERE id = ?",[analyzer]);
    await seed("INSERT INTO laboratory_results (id,organization_id,order_item_id,specimen_id,performing_branch_id,analyzer_id,entered_by_user_id,status,validation_stage,source,updated_at) VALUES (?,?,?,?,?,?,?,'ENTERED','TECHNICAL_REVIEW','ANALYZER',NOW(3))",
      [result,org,orderItem,specimen,branch,analyzer,user],"DELETE FROM laboratory_results WHERE id = ?",[result]);

    await first.beginTransaction();
    await first.execute("INSERT INTO analyzer_messages (id,analyzer_id,branch_id,direction,protocol,bridge_message_id,payload_hash,raw_payload,status,updated_at) VALUES (?,?,?,'INBOUND','HL7_V2',?,?,?,'RECEIVED',NOW(3))",
      [message,analyzer,branch,"MSG-1",hash,raw]);
    cleanup.unshift({sql:"DELETE FROM analyzer_messages WHERE id = ?",args:[message]});
    await second.query("SET SESSION innodb_lock_wait_timeout = 1");
    await second.beginTransaction();
    await assert.rejects(second.execute(
      "INSERT INTO analyzer_messages (id,analyzer_id,branch_id,direction,protocol,bridge_message_id,payload_hash,raw_payload,status,updated_at) VALUES (?,?,?,'INBOUND','HL7_V2',?,?,?,'RECEIVED',NOW(3))",
      [randomUUID(),analyzer,branch,"MSG-1",hash,raw]),
      (err:unknown)=>Boolean(err && typeof err==="object" && "code" in err && err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();
    await assert.rejects(second.execute(
      "INSERT INTO analyzer_messages (id,analyzer_id,branch_id,direction,protocol,bridge_message_id,payload_hash,raw_payload,status,updated_at) VALUES (?,?,?,'INBOUND','HL7_V2',?,?,?,'RECEIVED',NOW(3))",
      [randomUUID(),analyzer,branch,"MSG-1",hash,raw]),
      (err:unknown)=>Boolean(err && typeof err==="object" && "code" in err && err.code==="ER_DUP_ENTRY"));
    const [stored]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT raw_payload,payload_hash FROM analyzer_messages WHERE id = ?",[message]);
    assert.equal(stored[0]?.raw_payload,raw);
    assert.equal(stored[0]?.payload_hash,hash);

    // The staging transaction must protect the raw payload and its digest
    // under the exact same analyzer-message FOR UPDATE lock as child imports.
    // A concurrent writer cannot silently substitute an analyzer value while
    // an observation is being staged.
    await first.beginTransaction();
    const [lockedSource] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT raw_payload,payload_hash,protocol,bridge_message_id "+
      "FROM analyzer_messages WHERE id=? AND analyzer_id=? FOR UPDATE",
      [message,analyzer]);
    assert.equal(lockedSource[0]?.raw_payload,raw);
    assert.equal(lockedSource[0]?.payload_hash,hash);
    assert.equal(lockedSource[0]?.bridge_message_id,"MSG-1");
    await second.beginTransaction();
    await assert.rejects(second.execute(
      "UPDATE analyzer_messages SET raw_payload=?,payload_hash=? WHERE id=?",
      [raw.replace("MSG-1","MSG-TAMPER"),hash,message]),
      (err:unknown)=>Boolean(err && typeof err==="object" &&
        "code" in err && err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();
    const [unchangedSource] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT raw_payload,payload_hash FROM analyzer_messages WHERE id=?",[message]);
    assert.equal(unchangedSource[0]?.raw_payload,raw);
    assert.equal(unchangedSource[0]?.payload_hash,hash);

    await seed("INSERT INTO analyzer_result_imports (id,message_id,bridge_observation_id,analyzer_id,order_item_id,specimen_id,barcode_snapshot,analyzer_test_code,raw_value,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'MAPPED',NOW(3))",
      [importId,message,"MSG-1:1:1",analyzer,orderItem,specimen,"AN-BAR-"+suffix,"GLU","5.2"],
      "DELETE FROM analyzer_result_imports WHERE id = ?",[importId]);

    const [initial]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM laboratory_results WHERE id = ?",[result]);
    const revision=initial[0]?.updated_at as Date;
    await first.beginTransaction();
    const [custody]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,current_branch_id FROM specimens WHERE id=? AND organization_id=? FOR UPDATE",[specimen,org]);
    assert.equal(custody[0]?.status,"IN_PROCESS");
    assert.equal(custody[0]?.current_branch_id,branch);
    const [claimedImport]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status FROM analyzer_result_imports WHERE id=? FOR UPDATE",[importId]);
    assert.equal(claimedImport[0]?.status,"MAPPED");

    await second.beginTransaction();
    await assert.rejects(second.execute(
      "SELECT id FROM specimens WHERE id=? FOR UPDATE",[specimen]),
      (err:unknown)=>Boolean(err && typeof err==="object" && "code" in err && err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();

    const [claimedResult]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE laboratory_results SET updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=? AND organization_id=? AND source='ANALYZER' AND status='ENTERED' AND validation_stage='TECHNICAL_REVIEW' AND updated_at=?",
      [result,org,revision]);
    assert.equal(claimedResult.affectedRows,1);
    const [consumed]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_result_imports SET status='IMPORTED',result_id=? WHERE id=? AND status='MAPPED'",
      [result,importId]);
    assert.equal(consumed.affectedRows,1);
    await first.commit();

    const [late]=await second.execute<mysql.ResultSetHeader>(
      "UPDATE laboratory_results SET updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=? AND organization_id=? AND source='ANALYZER' AND status='ENTERED' AND validation_stage='TECHNICAL_REVIEW' AND updated_at=?",
      [result,org,revision]);
    assert.equal(late.affectedRows,0);
    const [after]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status,result_id FROM analyzer_result_imports WHERE id = ?",[importId]);
    assert.equal(after[0]?.status,"IMPORTED");
    assert.equal(after[0]?.result_id,result);
  } finally {
    await Promise.all([first.rollback().catch(()=>{}),second.rollback().catch(()=>{})]);
    for(const row of cleanup) await setup.execute(row.sql,row.args);
    await Promise.all([setup.end(),first.end(),second.end()]);
  }
});
