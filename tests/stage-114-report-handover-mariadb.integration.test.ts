import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {
  parseStaffReportHandover,reportHandoverFingerprint,
  reportSnapshotPatientNumber,
} from "../src/lib/report-handover.ts";

test("Stage 114 MariaDB: one staff handover record per retry token, immutable report scope and concurrent uniqueness",{timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [db,other]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),foreignBranch=randomUUID(),
    actor=randomUUID(),patient=randomUUID(),order=randomUUID(),report=randomUUID(),
    version1=randomUUID(),version2=randomUUID(),eventId=randomUUID(),requestId=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{table:string;column:string;value:string}>=[];
  async function insert(table:string,params:(string|number)[],sql:string,id:string){
    await db.execute(sql,params);
    cleanup.unshift({table,column:"id",value:id});
  }
  try{
    for(const [id,label]of [[org,"A"],[foreignOrg,"B"]])
      await insert("organizations",[id,"S114"+suffix+label,"Synthetic Lab"],
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",id);
    for(const [id,tenant,label]of [[branch,org,"A"],[foreignBranch,foreignOrg,"B"]])
      await insert("branches",[id,tenant,"S114"+suffix+label,"Synthetic Branch"],
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",id);
    await insert("users",[actor,org,"s114"+suffix,"Synthetic User"],
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",actor);
    await insert("patients",[patient,org,"S114"+suffix,"Historical Snapshot Patient","synthetic patient"],
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",patient);
    await insert("orders",[order,org,"S114-ACC-"+suffix,branch,patient,actor],
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",order);
    await insert("diagnostic_reports",[report,org,order],
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES (?,?,?,1,NOW(3))",report);
    await insert("diagnostic_report_versions",[version1,report,1,"FINAL",branch,
      JSON.stringify({patient:{patientNumber:"SNAP-114",fullNameEn:"Historical Patient"}}),
      "[]","s114"+randomUUID().replaceAll("-",""),actor],
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
      version1);
    const parsed=parseStaffReportHandover({
      handoverRequestId:requestId,patientNumber:"SNAP-114",
      verificationMethod:"PHOTO_ID_AND_PATIENT_NUMBER",attestedInPerson:true,
    });
    assert.equal(parsed.ok,true);
    if(!parsed.ok)throw Error("invalid synthetic request");
    const fingerprint=reportHandoverFingerprint(version1,parsed.value);
    const [snap]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT content_snapshot AS snap FROM diagnostic_report_versions WHERE id=?",
      [version1]);
    const historical=typeof snap[0].snap==="string"?JSON.parse(snap[0].snap):snap[0].snap;
    assert.equal(reportSnapshotPatientNumber(historical),"SNAP-114");

    await db.beginTransaction();
    const [locked]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT current_version FROM diagnostic_reports WHERE id=? AND organization_id=? FOR UPDATE",
      [report,org]);
    assert.equal(locked[0].current_version,1);
    const metadata={
      evidenceType:"STAFF_ATTESTED_IN_PERSON_HANDOVER_V1",
      requestFingerprint:fingerprint,
      recipientType:"PATIENT",independentPatientAcknowledgement:false,
    };
    await db.execute(
      "INSERT INTO report_delivery_events(id,report_version_id,channel,status,recipient,performed_by_user_id,handover_request_id,details,occurred_at) VALUES (?,?,'OTHER','RECORDED','PATIENT',?,?,?,NOW(3))",
      [eventId,version1,actor,requestId,JSON.stringify(metadata)]);
    cleanup.unshift({table:"report_delivery_events",column:"id",value:eventId});
    // A second connection must not create the same event during a retry.
    await other.execute("SET SESSION innodb_lock_wait_timeout = 1");
    await assert.rejects(other.execute(
      "INSERT INTO report_delivery_events(id,report_version_id,channel,status,recipient,performed_by_user_id,handover_request_id,details,occurred_at) VALUES (?,?,'OTHER','RECORDED','PATIENT',?,?,?,NOW(3))",
      [randomUUID(),version1,actor,requestId,JSON.stringify(metadata)]),
      (error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await db.commit();
    await assert.rejects(other.execute(
      "INSERT INTO report_delivery_events(id,report_version_id,channel,status,recipient,performed_by_user_id,handover_request_id,details,occurred_at) VALUES (?,?,'OTHER','RECORDED','PATIENT',?,?,?,NOW(3))",
      [randomUUID(),version1,actor,requestId,JSON.stringify(metadata)]),
      (error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ER_DUP_ENTRY"));
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,report_version_id,channel,status,recipient,performed_by_user_id,details FROM report_delivery_events WHERE handover_request_id=?",
      [requestId]);
    assert.equal(rows.length,1);
    assert.equal(rows[0].id,eventId);
    assert.equal(rows[0].report_version_id,version1);
    assert.equal(rows[0].status,"RECORDED");
    assert.equal(rows[0].channel,"OTHER");
    const details=typeof rows[0].details==="string"?JSON.parse(rows[0].details):rows[0].details;
    assert.equal(details.requestFingerprint,fingerprint);
    assert.equal(details.independentPatientAcknowledgement,false);
    assert.equal(JSON.stringify(details).includes("SNAP-114"),false,"patient identifier is not retained in handover metadata");

    const [unauthorized]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT r.id FROM diagnostic_reports r JOIN orders o ON o.id=r.order_id WHERE r.id=? AND r.organization_id=? AND o.ordering_branch_id=?",
      [report,foreignOrg,foreignBranch]);
    assert.equal(unauthorized.length,0);
    await insert("diagnostic_report_versions",[version2,report,2,"RETRACTED",branch,
      JSON.stringify({patient:{patientNumber:"SNAP-114"}}),
      "[]","s114"+randomUUID().replaceAll("-",""),actor],
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
      version2);
    await db.execute("UPDATE diagnostic_reports SET current_version=2 WHERE id=?",[report]);
    const [eligible]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT v.id FROM diagnostic_report_versions v JOIN diagnostic_reports r ON r.id=v.report_id WHERE v.id=? AND v.version=r.current_version AND v.status IN ('FINAL','AMENDED')",
      [version1]);
    assert.equal(eligible.length,0,"historically handed-out FINAL must not qualify for a NEW handover after retraction");
    const [withdrawn]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT v.id FROM diagnostic_report_versions v JOIN diagnostic_reports r ON r.id=v.report_id WHERE v.id=? AND v.version=r.current_version AND v.status IN ('FINAL','AMENDED')",
      [version2]);
    assert.equal(withdrawn.length,0);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),other.rollback().catch(()=>{})]);
    for(const row of cleanup)await db.execute(
      "DELETE FROM "+row.table+" WHERE "+row.column+"=?",[row.value]).catch(()=>{});
    await Promise.all([db.end(),other.end()]);
  }
});
