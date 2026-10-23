import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 password change: live MariaDB denies revoked patient or tenant after pre-hash session",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [change,admin]=await Promise.all([
    mysql.createConnection(options),mysql.createConnection(options),
  ]);
  const org=randomUUID(),patient=randomUUID(),account=randomUUID(),session=randomUUID();
  const tag=org.slice(0,8),initial="synthetic-initial-hash";
  const tokenHash=createHash("sha256").update(randomUUID()).digest("hex");

  async function attemptPasswordChange(expectedPatient=patient){
    await change.beginTransaction();
    try{
      const [a]=await change.execute<mysql.RowDataPacket[]>(
        "SELECT id,status FROM portal_accounts WHERE id=? "+
        "AND organization_id=? FOR UPDATE",[account,org]);
      if(a.length!==1||a[0].status!=="ACTIVE"){
        await change.rollback();return false;
      }
      const [principal]=await change.execute<mysql.RowDataPacket[]>(
        "SELECT a.id FROM portal_accounts a "+
        "JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE' "+
        "LEFT JOIN patients p ON p.id=a.patient_id "+
        "LEFT JOIN clients c ON c.id=a.client_id "+
        "LEFT JOIN referrers r ON r.id=a.referrer_id "+
        "WHERE a.id=? AND a.organization_id=? AND a.status='ACTIVE' "+
        "AND a.type='PATIENT' "+
        "AND (a.type='PATIENT' AND p.id=? AND p.status='ACTIVE' "+
        "AND p.organization_id=a.organization_id) FOR UPDATE",
        [account,org,expectedPatient]);
      if(principal.length!==1){
        await change.rollback();return false;
      }
      const [liveSession]=await change.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM portal_sessions WHERE id=? AND portal_account_id=? "+
        "AND revoked_at IS NULL AND expires_at>NOW(3)",[session,account]);
      if(liveSession.length!==1){
        await change.rollback();return false;
      }
      const [mutation]=await change.execute<mysql.ResultSetHeader>(
        "UPDATE portal_accounts SET password_hash=? WHERE id=? "+
        "AND organization_id=? AND status='ACTIVE'",
        ["synthetic-new-hash",account,org]);
      await change.commit();
      return mutation.affectedRows===1;
    }catch(e){await change.rollback().catch(()=>{});throw e;}
  }

  async function currentHash(){
    const [rows]=await change.execute<mysql.RowDataPacket[]>(
      "SELECT password_hash FROM portal_accounts WHERE id=?",[account]);
    return rows[0].password_hash;
  }

  try{
    await change.execute(
      "INSERT INTO organizations(id,code,name_en,updated_at) "+
      "VALUES(?,?,?,NOW(3))",[org,"PWP-LIVE-"+tag,"Synthetic Password Tenant"]);
    await change.execute(
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
      "VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"PWP-"+tag,"Synthetic Password Patient","synthetic password patient"]);
    await change.execute(
      "INSERT INTO portal_accounts"+
      "(id,organization_id,type,patient_id,password_hash,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES(?,?,'PATIENT',?,?,0,'en','ACTIVE',NOW(3))",
      [account,org,patient,initial]);
    await change.execute(
      "INSERT INTO portal_sessions(id,portal_account_id,token_hash,expires_at) "+
      "VALUES(?,?,?,DATE_ADD(NOW(3),INTERVAL 12 HOUR))",
      [session,account,tokenHash]);

    assert.equal(await attemptPasswordChange(randomUUID()),false,
      "a changed patient reference during bcrypt must fail");
    await admin.execute("UPDATE patients SET status='INACTIVE' WHERE id=?",[patient]);
    assert.equal(await attemptPasswordChange(),false,
      "patient deactivation after a live session snapshot must deny change");
    await admin.execute("UPDATE patients SET status='ACTIVE' WHERE id=?",[patient]);
    await admin.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[org]);
    assert.equal(await attemptPasswordChange(),false,
      "an inactive tenant cannot authorize password change");
    await admin.execute("UPDATE organizations SET status='ACTIVE' WHERE id=?",[org]);

    await admin.execute("UPDATE portal_sessions SET revoked_at=NOW(3) WHERE id=?",[session]);
    assert.equal(await attemptPasswordChange(),false,
      "session revocation must still fail after linked principal validation");
    assert.equal(await currentHash(),initial,
      "all denied attempts must leave original password unchanged");

    await admin.execute("UPDATE portal_sessions SET revoked_at=NULL WHERE id=?",[session]);
    assert.equal(await attemptPasswordChange(),true);
    assert.equal(await currentHash(),"synthetic-new-hash");
  }finally{
    await change.execute("DELETE FROM portal_sessions WHERE id=?",[session]).catch(()=>{});
    await change.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    await change.execute("DELETE FROM patients WHERE id=?",[patient]).catch(()=>{});
    await change.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([change.end(),admin.end()]);
  }
});
