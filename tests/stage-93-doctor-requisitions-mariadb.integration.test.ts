import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 93 MariaDB: tenant isolation, independent doctor grants, idempotency, serialized conversion and frozen selections",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    doctor=randomUUID(),patient=randomUUID(),foreignPatient=randomUUID(),
    actor=randomUUID(),portal=randomUUID(),grant=randomUUID(),testId=randomUUID(),
    req=randomUUID(),item=randomUUID(),order=randomUUID(),audit=randomUUID(),
    reqKey=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|number|null)[]) {
    await db.execute(sql,args);cleanup.push({table,id});
  }
  try {
    for(const [id,tag] of [[org,"A"],[foreignOrg,"B"]])await put("organizations",id,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S93"+suffix+tag,"Stage93 Lab"]);
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S93"+suffix,"Reception"]);
    await put("users",actor,
      "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [actor,org,"s93"+suffix,"Reception staff"]);
    await put("referrers",doctor,
      "INSERT INTO referrers(id,organization_id,code,name_en,type,status,updated_at) "+
      "VALUES(?,?,?,?,'PHYSICIAN','ACTIVE',NOW(3))",
      [doctor,org,"S93DOC"+suffix,"Physician"]);
    for(const [id,tenant,name] of [[patient,org,"Patient"],[foreignPatient,foreignOrg,"Foreign"]]) {
      await put("patients",id,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,status,updated_at) "+
        "VALUES(?,?,?,?,?,'ACTIVE',NOW(3))",
        [id,tenant,"S93"+id.slice(0,8),name,name.toLowerCase()]);
    }
    await put("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [testId,org,"S93TEST"+suffix,"Original assay name"]);
    await put("portal_accounts",portal,
      "INSERT INTO portal_accounts(id,organization_id,type,referrer_id,status,updated_at) "+
      "VALUES(?,?,'DOCTOR',?,'ACTIVE',NOW(3))",[portal,org,doctor]);
    await put("doctor_portal_patient_access",grant,
      "INSERT INTO doctor_portal_patient_access(id,organization_id,referrer_id,patient_id,"+
      "can_view_orders,can_view_reports,effective_from,status,reason,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,1,1,DATE_SUB(NOW(3),INTERVAL 1 DAY),'ACTIVE',?,?,NOW(3))",
      [grant,org,doctor,patient,"Previously approved view only",actor]);
    const eligibility="SELECT id FROM doctor_portal_patient_access WHERE id=? AND organization_id=? "+
      "AND referrer_id=? AND patient_id=? AND can_request_orders=TRUE AND status='ACTIVE' "+
      "AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>=NOW(3))";
    const [initial]=await db.execute<mysql.RowDataPacket[]>(eligibility,[grant,org,doctor,patient]);
    assert.equal(initial.length,0,"existing doctor view grant must NOT permit ordering");
    await db.execute("UPDATE doctor_portal_patient_access SET can_request_orders=TRUE WHERE id=?",[grant]);
    const [authorized]=await db.execute<mysql.RowDataPacket[]>(eligibility,[grant,org,doctor,patient]);
    assert.equal(authorized.length,1);
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(eligibility,[grant,org,doctor,foreignPatient]);
    assert.equal(foreign.length,0,"physician cannot order for unrelated tenant patient");
    await put("doctor_requisitions",req,
      "INSERT INTO doctor_requisitions(id,organization_id,branch_id,patient_id,referrer_id,"+
      "portal_account_id,client_request_id,request_fingerprint,status,priority,diagnosis) "+
      "VALUES(?,?,?,?,?,?,?,REPEAT('a',64),'SUBMITTED','ROUTINE',?)",
      [req,org,branch,patient,doctor,portal,reqKey,"Approved clinical indication"]);
    await put("doctor_requisition_items",item,
      "INSERT INTO doctor_requisition_items(id,requisition_id,test_id,test_code_snapshot,test_name_en_snapshot) "+
      "VALUES(?,?,?,?,?)",[item,req,testId,"S93ORIGINAL","Frozen original name"]);
    await assert.rejects(db.execute(
      "INSERT INTO doctor_requisitions(id,organization_id,branch_id,patient_id,referrer_id,"+
      "portal_account_id,client_request_id,request_fingerprint) "+
      "VALUES(?,?,?,?,?,?,?,REPEAT('b',64))",
      [randomUUID(),org,branch,patient,doctor,portal,reqKey]),
      "same clinician request key cannot create a second clinical requisition");
    const [noOrders]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE patient_id=? AND organization_id=?",[patient,org]);
    assert.equal(noOrders.length,0,"submission alone must not create a billable LIS order");
    const [foreignRead]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM doctor_requisitions WHERE id=? AND organization_id=?",[req,foreignOrg]);
    assert.equal(foreignRead.length,0);
    await db.beginTransaction();
    const [locked]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM doctor_requisitions WHERE id=? AND status='SUBMITTED' FOR UPDATE",[req]);
    assert.equal(locked.length,1);
    await rival.query("SET innodb_lock_wait_timeout=1");
    await rival.beginTransaction();
    let blocked=false;
    try{await rival.execute("UPDATE doctor_requisitions SET status='DECLINED' WHERE id=?",[req]);}
    catch{blocked=true;}
    await rival.rollback();
    assert.equal(blocked,true,"reception decline/cancel and conversion cannot win simultaneously");
    await db.execute(
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,referrer_id,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,NOW(3))",
      [order,org,"S93"+suffix+"ACC",branch,patient,doctor,actor]);
    cleanup.push({table:"orders",id:order});
    const [changed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE doctor_requisitions SET status='FULFILLED',fulfilled_order_id=?,resolved_by_user_id=?,resolved_at=NOW(3) "+
      "WHERE id=? AND organization_id=? AND status='SUBMITTED' AND fulfilled_order_id IS NULL",
      [order,actor,req,org]);
    assert.equal(changed.affectedRows,1);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'DOCTOR_ELECTRONIC_REQUISITION_FULFILLED','DoctorRequisition',?,?)",
      [audit,org,branch,actor,req,JSON.stringify({orderId:order})]);
    cleanup.push({table:"audit_events",id:audit});
    await db.commit();
    const [second]=await rival.execute<mysql.ResultSetHeader>(
      "UPDATE doctor_requisitions SET status='FULFILLED' WHERE id=? AND status='SUBMITTED'",[req]);
    assert.equal(second.affectedRows,0,"cannot bill same requisition twice");
    const [cannotCancel]=await rival.execute<mysql.ResultSetHeader>(
      "UPDATE doctor_requisitions SET status='CANCELLED' WHERE id=? AND status='SUBMITTED'",[req]);
    assert.equal(cannotCancel.affectedRows,0);
    await db.execute("UPDATE lab_tests SET name_en=? WHERE id=?",["Renamed future test",testId]);
    const [frozen]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT test_code_snapshot,test_name_en_snapshot FROM doctor_requisition_items WHERE id=?",[item]);
    assert.equal(frozen[0].test_code_snapshot,"S93ORIGINAL");
    assert.equal(frozen[0].test_name_en_snapshot,"Frozen original name");
    const [linked]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT status,fulfilled_order_id,resolved_by_user_id FROM doctor_requisitions WHERE id=?",[req]);
    assert.equal(linked[0].status,"FULFILLED");
    assert.equal(linked[0].fulfilled_order_id,order);
    assert.equal(linked[0].resolved_by_user_id,actor);
    const [auditRows]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id FROM audit_events WHERE id=? AND action='DOCTOR_ELECTRONIC_REQUISITION_FULFILLED'",[audit]);
    assert.equal(auditRows[0].actor_user_id,actor);
  } finally {
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const table of ["audit_events","doctor_requisition_items","doctor_requisitions","orders",
      "doctor_portal_patient_access","portal_accounts","lab_tests","patients","referrers",
      "users","branches","organizations"]) {
      for(const {table:source,id} of cleanup.filter(x=>x.table===table))
        await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    }
    await Promise.all([db.end(),rival.end()]);
  }
});
