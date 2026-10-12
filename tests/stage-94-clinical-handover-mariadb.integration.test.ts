import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 94 MariaDB: immutable handover, tenant isolation, ack uniqueness and serialized correction",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const cfg={host:u.hostname,port:Number(u.port||3306),
  user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
  database:u.pathname.slice(1)};
 const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
 const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
   patient=randomUUID(),author=randomUUID(),reviewer=randomUUID(),order=randomUUID(),
   original=randomUUID(),revision=randomUUID(),ack=randomUUID(),event=randomUUID(),
   thread=randomUUID(),req1=randomUUID(),req2=randomUUID(),suffix=org.slice(0,8);
 const garbage:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
   await db.execute(sql,args);garbage.unshift({table,id});
 }
 try{
  for(const [id,tag]of [[org,"A"],[foreignOrg,"B"]])await put("organizations",id,
   "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
   [id,"S94"+suffix+tag,"Stage94 Lab"]);
  for(const [id,tag] of [[branch,"A"],[otherBranch,"B"]])await put("branches",id,
   "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [id,org,"S94"+suffix+tag,"Stage94 Branch"]);
  for(const [id,tag] of [[author,"A"],[reviewer,"B"]])await put("users",id,
   "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [id,org,"s94"+suffix+tag,"Stage94 Staff"]);
  await put("patients",patient,
   "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
   [patient,org,"S94"+suffix+"P","Stage94 Patient","stage94 patient"]);
  await put("orders",order,
   "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
   [order,org,"S94"+suffix+"ACC",branch,patient,author]);
  await put("order_clinical_notes",original,
   "INSERT INTO order_clinical_notes(id,organization_id,branch_id,order_id,thread_id,revision_number,client_request_id,"+
   "request_fingerprint,category,language,body,requires_acknowledgement,created_by_user_id) "+
   "VALUES(?,?,?,?,?,1,?,REPEAT('a',64),'COLLECTION_INSTRUCTION','ar',?,1,?)",
   [original,org,branch,order,thread,req1,"Original sample collection instruction",author]);
  const [crossTenant]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM order_clinical_notes WHERE id=? AND organization_id=?",[original,foreignOrg]);
  assert.equal(crossTenant.length,0,"clinical text cannot cross tenant");
  const [wrongBranch]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM order_clinical_notes WHERE id=? AND branch_id=?",[original,otherBranch]);
  assert.equal(wrongBranch.length,0,"note must not appear in another branch");
  await assert.rejects(db.execute(
   "INSERT INTO order_clinical_notes(id,organization_id,branch_id,order_id,thread_id,revision_number,client_request_id,"+
   "request_fingerprint,category,language,body,created_by_user_id) "+
   "VALUES(?,?,?,?,?,1,?,REPEAT('b',64),'LAB_HANDOVER','en','duplicate',?)",
   [randomUUID(),org,branch,order,randomUUID(),req1,author]),
   "same actor + idempotency key cannot create a second note");
  await assert.rejects(db.execute(
   "INSERT INTO order_clinical_notes(id,organization_id,branch_id,order_id,thread_id,revision_number,client_request_id,"+
   "request_fingerprint,category,language,body,created_by_user_id) "+
   "VALUES(?,?,?,?,?,1,?,REPEAT('b',64),'LAB_HANDOVER','en','fork',?)",
   [randomUUID(),org,branch,order,thread,randomUUID(),author]),
   "same order, thread and revision cannot fork");
  await put("order_clinical_note_acknowledgements",ack,
   "INSERT INTO order_clinical_note_acknowledgements(id,note_id,acknowledged_by_user_id) VALUES(?,?,?)",
   [ack,original,reviewer]);
  await assert.rejects(db.execute(
   "INSERT INTO order_clinical_note_acknowledgements(id,note_id,acknowledged_by_user_id) VALUES(?,?,?)",
   [randomUUID(),original,reviewer]),"same reviewer cannot acknowledge twice");
  await db.beginTransaction();
  const [locked]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM orders WHERE id=? AND organization_id=? FOR UPDATE",[order,org]);
  assert.equal(locked.length,1);
  await rival.query("SET innodb_lock_wait_timeout=1");
  await rival.beginTransaction();
  let blocked=false;
  try{await rival.execute("UPDATE orders SET updated_at=NOW(3) WHERE id=?",[order]);}
  catch{blocked=true;}
  await rival.rollback();
  assert.equal(blocked,true,"parallel writer must not bypass per-order serialization");
  const [retired]=await db.execute<mysql.ResultSetHeader>(
   "UPDATE order_clinical_notes SET status='SUPERSEDED',retired_by_user_id=?,retired_at=NOW(3),"+
   "retirement_reason=? WHERE id=? AND organization_id=? AND order_id=? AND status='ACTIVE'",
   [author,"Corrected collection timing information",original,org,order]);
  assert.equal(retired.affectedRows,1);
  await db.execute(
   "INSERT INTO order_clinical_notes(id,organization_id,branch_id,order_id,thread_id,revision_number,client_request_id,"+
   "request_fingerprint,category,language,body,requires_acknowledgement,replaces_note_id,correction_reason,created_by_user_id) "+
   "VALUES(?,?,?,?,?,2,?,REPEAT('c',64),'COLLECTION_INSTRUCTION','ar',?,1,?,?,?)",
   [revision,org,branch,order,thread,req2,"Corrected sample collection instruction",original,
    "Corrected collection timing information",author]);
  garbage.unshift({table:"order_clinical_notes",id:revision});
  await db.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) "+
   "VALUES(?,?,?,?,'ORDER_CLINICAL_HANDOVER_CORRECTED','OrderClinicalNote',?)",
   [event,org,branch,author,revision]);
  garbage.unshift({table:"audit_events",id:event});
  await db.commit();
  const [history]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT id,revision_number,body,status,replaces_note_id FROM order_clinical_notes "+
   "WHERE order_id=? AND thread_id=? ORDER BY revision_number",[order,thread]);
  assert.equal(history.length,2);
  assert.equal(history[0].body,"Original sample collection instruction");
  assert.equal(history[0].status,"SUPERSEDED");
  assert.equal(history[1].body,"Corrected sample collection instruction");
  assert.equal(history[1].status,"ACTIVE");
  assert.equal(history[1].replaces_note_id,original);
  const [ackHistory]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM order_clinical_note_acknowledgements WHERE note_id=?",[original]);
  assert.equal(ackHistory.length,1,"old signed acknowledgements remain as historical evidence");
  const [newAck]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM order_clinical_note_acknowledgements WHERE note_id=?",[revision]);
  assert.equal(newAck.length,0,"correction cannot inherit old acknowledgements");
  const [auditRow]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT actor_user_id,branch_id FROM audit_events WHERE id=?",[event]);
  assert.equal(auditRow[0].actor_user_id,author);
  assert.equal(auditRow[0].branch_id,branch);
  const [stale]=await rival.execute<mysql.ResultSetHeader>(
   "UPDATE order_clinical_notes SET status='RETRACTED' WHERE id=? AND status='ACTIVE'",[original]);
  assert.equal(stale.affectedRows,0,"superseded note cannot be retracted as current");
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
  for(const {table,id} of garbage){
   await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
  }
  await Promise.all([db.end(),rival.end()]);
 }
});
