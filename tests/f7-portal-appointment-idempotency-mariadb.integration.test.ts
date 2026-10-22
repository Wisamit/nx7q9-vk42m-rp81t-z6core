import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {
  portalBookingSubmissionKey, portalBookingIntentHash,evaluatePortalBookingReplay,
} from "../src/lib/portal-appointment-idempotency.ts";

/**
 * Real MariaDB UNIQUE enforcement with two independent connections.
 * No mocked locks, fake single-process mutexes or patient PII.
 */
test("F7 portal bookings: a concurrent matching portal account+UUID key creates one appointment",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [one,two]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    patient=randomUUID(),otherPatient=randomUUID(),portal=randomUUID(),otherPortal=randomUUID(),
    key=randomUUID();
  const tag=org.slice(0,8);
  const intent={portalAccountId:portal,branchId:branch,patientId:patient,
    mode:"ONSITE",serviceCode:"CBC",serviceNameSnapshot:"Synthetic appointment",
    address:null,notes:null,timeSource:"BRANCH_LOCAL",requestedTime:"2026-10-23T10:00"};
  const hash=portalBookingIntentHash(intent);
  const ids:string[]=[];
  async function create(conn:typeof one,accountId:string,branchId:string,
    patientId:string,token:string|null,snapshotHash:string|null,suffix:string) {
    const id=randomUUID();
    await conn.execute(
      "INSERT INTO appointments(id,organization_id,branch_id,patient_id,portal_account_id,"+
      "portal_submission_key,portal_submission_hash,appointment_number,service_name_snapshot,"+
      "scheduled_start,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'2026-10-23 06:00:00.000','REQUESTED',NOW(3))",
      [id,accountId===portal?org:otherOrg,branchId,patientId,accountId,token,snapshotHash,
        "WEB-"+tag+"-"+suffix,"Synthetic appointment"],
    );
    ids.push(id);
    return id;
  }
  try {
    for(const [id,suffix] of [[org,"A"],[otherOrg,"B"]]){
      await one.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"PBID-"+tag+suffix,"Synthetic Booking Tenant"]);
    }
    for(const [id,orgId,suffix] of [[branch,org,"A"],[otherBranch,otherOrg,"B"]]){
      await one.execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,orgId,"PBID-"+tag+suffix,"Synthetic Branch"]);
    }
    for(const [id,orgId,suffix] of [[patient,org,"A"],[otherPatient,otherOrg,"B"]]){
      await one.execute("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,orgId,"PBID-"+tag+suffix,"Synthetic Person","SYNTHETIC PERSON"]);
    }
    for(const [id,orgId,patientId] of [[portal,org,patient],[otherPortal,otherOrg,otherPatient]]){
      await one.execute(
        "INSERT INTO portal_accounts(id,organization_id,type,patient_id,preferred_locale,status,updated_at) "+
        "VALUES(?,?,'PATIENT',?,'en','ACTIVE',NOW(3))",
        [id,orgId,patientId],
      );
    }
    const results=await Promise.allSettled([
      create(one,portal,branch,patient,key,hash,"X1"),
      create(two,portal,branch,patient,key,hash,"X2"),
    ]);
    assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
    const rejected=results.find(x=>x.status==="rejected") as PromiseRejectedResult|undefined;
    assert.equal(rejected?.reason?.code,"ER_DUP_ENTRY","DB must enforce atomic keyed dedup");
    const [rows]=await one.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,portal_submission_hash,branch_id,patient_id FROM appointments "+
      "WHERE portal_account_id=? AND portal_submission_key=?",[portal,key]);
    assert.equal(rows.length,1);
    const evaluated=evaluatePortalBookingReplay({
      id:rows[0].id,status:rows[0].status,portalSubmissionHash:rows[0].portal_submission_hash,
      branchId:rows[0].branch_id,patientId:rows[0].patient_id,
    },hash);
    assert.equal(evaluated.kind,"replay");
    assert.equal(evaluatePortalBookingReplay({
      id:rows[0].id,status:rows[0].status,portalSubmissionHash:rows[0].portal_submission_hash,
      branchId:rows[0].branch_id,patientId:rows[0].patient_id,
    },portalBookingIntentHash({...intent,requestedTime:"2026-10-24T10:00"})).kind,"conflict");

    // A different portal account in a different tenant may reuse the same UUID
    // without being shown or modifying the original tenant's appointment.
    await create(one,otherPortal,otherBranch,otherPatient,key,
      portalBookingIntentHash({...intent,portalAccountId:otherPortal,branchId:otherBranch,patientId:otherPatient}),"X3");
    const [other]=await one.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM appointments WHERE portal_account_id=? AND portal_submission_key=?",
      [otherPortal,key]);
    assert.equal(other.length,1);
    assert.notEqual(rows[0].id,other[0].id);

    // Old records and unkeyed API clients still permit multiple NULL keys.
    await create(one,portal,branch,patient,null,null,"OLD1");
    await create(one,portal,branch,patient,null,null,"OLD2");
    assert.deepEqual(portalBookingSubmissionKey(key.toUpperCase()),{valid:true,key});
  } finally {
    await one.execute("DELETE FROM appointments WHERE appointment_number LIKE ?",
      ["WEB-"+tag+"-%"]).catch(()=>{});
    await one.execute("DELETE FROM portal_accounts WHERE id IN (?,?)",
      [portal,otherPortal]).catch(()=>{});
    await one.execute("DELETE FROM patients WHERE id IN (?,?)",
      [patient,otherPatient]).catch(()=>{});
    await one.execute("DELETE FROM branches WHERE id IN (?,?)",
      [branch,otherBranch]).catch(()=>{});
    await one.execute("DELETE FROM organizations WHERE id IN (?,?)",
      [org,otherOrg]).catch(()=>{});
    await Promise.all([one.end(),two.end()]);
  }
});
