import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { interpretationFingerprint, interpretationReviewError } from "../src/lib/report-interpretation.ts";

test("Stage 92 MariaDB: immutable issued report, bilingual approved interpretation and independent audit",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,otherConnection]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    author=randomUUID(),reviewer=randomUUID(),patient=randomUUID(),testId=randomUUID(),
    orderId=randomUUID(),itemId=randomUUID(),reportId=randomUUID(),
    oldReportId=randomUUID(),newReportId=randomUUID(),noteId=randomUUID(),
    otherNoteId=randomUUID(), audit1=randomUUID(),audit2=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
    await db.execute(sql,args);cleanup.unshift({table,id});
  }
  try{
    for(const [id,k] of [[org,"A"],[foreignOrg,"B"]])
      await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S92"+suffix+k,"Stage92 Lab"]);
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S92"+suffix,"Report Origin"]);
    for(const [id,k] of [[author,"A"],[reviewer,"B"]])
      await put("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"s92"+suffix+k,"Stage92 Reviewer"]);
    await put("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"S92"+suffix+"P","Stage92 Patient","stage92 patient"]);
    await put("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"S92"+suffix+"T","Stage92 Test"]);
    await put("orders",orderId,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [orderId,org,"S92"+suffix+"ACC",branch,patient,author]);
    await put("order_items",itemId,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [itemId,orderId,testId,"S92TEST","Stage92 Test"]);
    await put("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [reportId,org,orderId]);
    await put("diagnostic_report_versions",oldReportId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) "+
      "VALUES(?, ?,1,'FINAL',?, ?,?, ?,?, NOW(3))",
      [oldReportId,reportId,branch,JSON.stringify({order:{id:orderId},reportInterpretation:null}),
        JSON.stringify([]),randomUUID(),reviewer]);
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE id=? AND organization_id=?",[orderId,foreignOrg]);
    assert.equal(foreign.length,0,"other tenant cannot retrieve same order");
    await db.beginTransaction();
    const [lock]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE id=? AND organization_id=? FOR UPDATE",[orderId,org]);
    assert.equal(lock.length,1);
    await otherConnection.query("SET innodb_lock_wait_timeout=1");
    await otherConnection.beginTransaction();
    let lockBlocked=false;
    try{await otherConnection.execute("UPDATE orders SET updated_at=NOW(3) WHERE id=?",[orderId]);}
    catch{lockBlocked=true;}
    await otherConnection.rollback();
    assert.equal(lockBlocked,true,"parallel reviewer/drafter cannot bypass order lock");
    const textEn="Clinically reviewed approved bilingual interpretation";
    const textAr="تفسير سريري معتمد موثق باللغتين";
    await db.execute("INSERT INTO report_interpretive_comments(id,organization_id,order_id,revision_number,status,"+
      "text_en,text_ar,created_by_user_id) VALUES(?,?,?,1,'DRAFT',?,?,?)",
      [noteId,org,orderId,textEn,textAr,author]);
    cleanup.unshift({table:"report_interpretive_comments",id:noteId});
    await assert.rejects(db.execute(
      "INSERT INTO report_interpretive_comments(id,organization_id,order_id,revision_number,status,text_en,text_ar,created_by_user_id) "+
      "VALUES(?,?,?,1,'DRAFT','fork','تفرع',?)",
      [otherNoteId,org,orderId,author]),"order+revision unique index prevents duplicate revision");
    await db.commit();
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM report_interpretive_comments WHERE id=?",[noteId]);
    const note=rows[0];
    const model={id:noteId,organizationId:org,orderId,revisionNumber:1,
      status:"DRAFT" as const,textEn,textAr,supersedesCommentId:null,createdByUserId:author,
      createdAt:new Date(note.created_at)};
    const token=interpretationFingerprint(model);
    assert.equal(interpretationReviewError(model,author,token,null),"independent_reviewer_required");
    assert.equal(interpretationReviewError(model,reviewer,token,null),null);
    await db.beginTransaction();
    const [approved]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE report_interpretive_comments SET status='APPROVED',approved_by_user_id=?,approved_at=NOW(3),review_reason=? "+
      "WHERE id=? AND order_id=? AND status='DRAFT'",
      [reviewer,"Independently verified full bilingual clinical text",noteId,orderId]);
    assert.equal(approved.affectedRows,1);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
      "VALUES(?,?,?,?,'REPORT_INTERPRETATION_INDEPENDENTLY_APPROVED','ReportInterpretiveComment',?,?,?)",
      [audit1,org,branch,reviewer,noteId,"Independently verified full bilingual clinical text",
        JSON.stringify({revisionNumber:1,appliesTo:"FUTURE_REPORT_VERSIONS_ONLY"})]);
    cleanup.unshift({table:"audit_events",id:audit1});
    const [frozen]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,revision_number,text_en,text_ar,approved_at,approved_by_user_id "+
      "FROM report_interpretive_comments WHERE order_id=? AND status='APPROVED' ORDER BY revision_number DESC LIMIT 1",
      [orderId]);
    const payload={order:{id:orderId},reportInterpretation:{
      id:frozen[0].id,revisionNumber:frozen[0].revision_number,
      textEn:frozen[0].text_en,textAr:frozen[0].text_ar,
      approvedByUserId:frozen[0].approved_by_user_id,
    }};
    await db.execute(
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at,supersedes_version_id,amendment_reason) "+
      "VALUES(?,?,2,'AMENDED',?,?,?, ?,?,NOW(3),?,?)",
      [newReportId,reportId,branch,JSON.stringify(payload),JSON.stringify([]),
        randomUUID(),reviewer,oldReportId,"Reviewed additional report interpretation"]);
    cleanup.unshift({table:"diagnostic_report_versions",id:newReportId});
    await db.execute("UPDATE diagnostic_reports SET current_version=2 WHERE id=?",[reportId]);
    await db.commit();
    const [versions]=await otherConnection.execute<mysql.RowDataPacket[]>(
      "SELECT version,content_snapshot FROM diagnostic_report_versions WHERE report_id=? ORDER BY version",
      [reportId]);
    assert.equal(versions.length,2);
    const decode=(data:unknown)=>typeof data==="string"?JSON.parse(data):data as Record<string,unknown>;
    assert.equal((decode(versions[0].content_snapshot) as {reportInterpretation:null}).reportInterpretation,null);
    const current=decode(versions[1].content_snapshot) as typeof payload;
    assert.equal(current.reportInterpretation.textEn,textEn);
    assert.equal(current.reportInterpretation.textAr,textAr);
    const [events]=await otherConnection.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,action FROM audit_events WHERE id=?",[audit1]);
    assert.equal(events[0].actor_user_id,reviewer);
    // Approval of subsequent bilingual text retires preceding only when the
    // new approval transaction commits; issued report content stays copied.
    await db.beginTransaction();
    await db.execute("UPDATE report_interpretive_comments SET status='RETIRED' WHERE id=? AND status='APPROVED'",[noteId]);
    await db.execute("INSERT INTO report_interpretive_comments(id,organization_id,order_id,revision_number,status,"+
      "text_en,text_ar,supersedes_comment_id,created_by_user_id,approved_by_user_id,approved_at,review_reason) "+
      "VALUES(?,?,?,2,'APPROVED',?,?,?,?,?,NOW(3),?)",
      [otherNoteId,org,orderId,"Updated interpretation","التفسير المحدّث",noteId,author,reviewer,
        "Independent approval of a subsequent updated report comment"]);
    cleanup.unshift({table:"report_interpretive_comments",id:otherNoteId});
    await db.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
      "VALUES(?,?,?,?,'REPORT_INTERPRETATION_SUPERSEDED','ReportInterpretiveComment',?,?,?)",
      [audit2,org,branch,reviewer,noteId,"Superseded by approved revision",
        JSON.stringify({status:"RETIRED",supersededById:otherNoteId})]);
    cleanup.unshift({table:"audit_events",id:audit2});
    await db.commit();
    const [preserved]=await otherConnection.execute<mysql.RowDataPacket[]>(
      "SELECT content_snapshot FROM diagnostic_report_versions WHERE id=?",[newReportId]);
    assert.equal((decode(preserved[0].content_snapshot) as typeof payload).reportInterpretation.textEn,textEn,
      "later approval cannot mutate already-issued report");
    const [history]=await otherConnection.execute<mysql.RowDataPacket[]>(
      "SELECT status,text_en,text_ar FROM report_interpretive_comments WHERE id=?",[noteId]);
    assert.equal(history[0].status,"RETIRED");
    assert.equal(history[0].textEn,undefined);
    assert.equal(history[0].text_en,textEn);
    assert.equal(history[0].text_ar,textAr);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),otherConnection.rollback().catch(()=>{})]);
    for(const {table,id} of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([db.end(),otherConnection.end()]);
  }
});
