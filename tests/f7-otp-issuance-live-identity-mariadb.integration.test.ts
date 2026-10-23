import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 OTP issue: real MariaDB rejects patient, organization and session revocation after pre-read",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for live MariaDB");
  const url=new URL(process.env.DATABASE_URL);
  const opts={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [issuer,revoker]=await Promise.all([
    mysql.createConnection(opts),mysql.createConnection(opts),
  ]);
  const org=randomUUID(),patient=randomUUID(),account=randomUUID(),session=randomUUID();
  const tokenHash=createHash("sha256").update(randomUUID()).digest("hex");
  const tag=org.slice(0,8),dest=`otp-live-${tag}@example.invalid`;
  const codes:string[]=[];

  async function issue(expectedRef=patient){
    await issuer.beginTransaction();
    try{
      // Same live tenant/identity SQL and lock order as OTP issue route:
      // a valid cookie read before bcrypt must not authorize a new code.
      const [accounts]=await issuer.execute<mysql.RowDataPacket[]>(
        "SELECT id,email,phone,must_change_password FROM portal_accounts "+
        "WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
        [account,org]);
      if(accounts.length!==1||accounts[0].must_change_password||
        accounts[0].email?.trim()!==dest){
        await issuer.rollback();return "DENIED";
      }
      const [principals]=await issuer.execute<mysql.RowDataPacket[]>(
        "SELECT a.id FROM portal_accounts a "+
        "JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE' "+
        "LEFT JOIN patients p ON p.id=a.patient_id "+
        "LEFT JOIN clients c ON c.id=a.client_id "+
        "LEFT JOIN referrers r ON r.id=a.referrer_id "+
        "WHERE a.id=? AND a.organization_id=? AND a.status='ACTIVE' "+
        "AND a.must_change_password=0 AND a.type='PATIENT' "+
        "AND (a.type='PATIENT' AND p.id=? AND p.status='ACTIVE' "+
        "AND p.organization_id=a.organization_id) FOR UPDATE",
        [account,org,expectedRef]);
      if(principals.length!==1){
        await issuer.rollback();return "DENIED";
      }
      const [sessions]=await issuer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM portal_sessions WHERE id=? AND portal_account_id=? "+
        "AND revoked_at IS NULL AND expires_at>NOW(3) FOR UPDATE",
        [session,account]);
      if(sessions.length!==1){
        await issuer.rollback();return "DENIED";
      }
      const id=randomUUID();
      await issuer.execute(
        "INSERT INTO portal_otp_challenges "+
        "(id,portal_account_id,purpose,destination,code_hash,expires_at) "+
        "VALUES (?,?,'VERIFY_CONTACT',?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE))",
        [id,account,dest,"synthetic-otp-hash"]);
      codes.push(id);
      await issuer.commit();
      return "ISSUED";
    }catch(e){await issuer.rollback().catch(()=>{});throw e;}
  }
  try{
    await issuer.execute(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"OTPLIVE-"+tag,"Synthetic OTP Live Identity"]);
    await issuer.execute(
      "INSERT INTO patients"+
      "(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
      "VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"OTPLIVE-"+tag,"Synthetic Patient","synthetic patient"]);
    await issuer.execute(
      "INSERT INTO portal_accounts"+
      "(id,organization_id,type,patient_id,email,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES (?,?,'PATIENT',?,?,0,'en','ACTIVE',NOW(3))",
      [account,org,patient,dest]);
    await issuer.execute(
      "INSERT INTO portal_sessions"+
      "(id,portal_account_id,token_hash,expires_at) "+
      "VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 12 HOUR))",
      [session,account,tokenHash]);

    assert.equal(await issue(),"ISSUED");
    assert.equal(await issue(randomUUID()),"DENIED",
      "pre-bcrypt-linked ID must match current principal");

    await revoker.execute("UPDATE patients SET status='INACTIVE' WHERE id=?",[patient]);
    assert.equal(await issue(),"DENIED","revoked patient blocks issuance");
    await revoker.execute("UPDATE patients SET status='ACTIVE' WHERE id=?",[patient]);

    await revoker.execute("UPDATE portal_sessions SET revoked_at=NOW(3) WHERE id=?",[session]);
    assert.equal(await issue(),"DENIED","revoked portal session blocks issuance");
    await revoker.execute("UPDATE portal_sessions SET revoked_at=NULL WHERE id=?",[session]);

    await revoker.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[org]);
    assert.equal(await issue(),"DENIED","deactivated tenant blocks issuance");
    await revoker.execute("UPDATE organizations SET status='ACTIVE' WHERE id=?",[org]);

    await revoker.execute("UPDATE portal_sessions SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 MINUTE) WHERE id=?",[session]);
    assert.equal(await issue(),"DENIED","expired session blocks issuance");

    const [rows]=await issuer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM portal_otp_challenges WHERE portal_account_id=?",
      [account]);
    assert.equal(Number(rows[0].n),1,"no denied scenario may create an extra OTP");
  }finally{
    for(const id of codes)await issuer.execute(
      "DELETE FROM portal_otp_challenges WHERE id=?",[id]).catch(()=>{});
    await issuer.execute("DELETE FROM portal_sessions WHERE id=?",[session]).catch(()=>{});
    await issuer.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    await issuer.execute("DELETE FROM patients WHERE id=?",[patient]).catch(()=>{});
    await issuer.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([issuer.end(),revoker.end()]);
  }
});
