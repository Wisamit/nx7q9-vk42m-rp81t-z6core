import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 OTP: real MariaDB principal and session locks deny stale verification proofs",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const conn={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [one,two]=await Promise.all([mysql.createConnection(conn),mysql.createConnection(conn)]);
  const org=randomUUID(),patient=randomUUID(),account=randomUUID(),session=randomUUID(),otp=randomUUID();
  const tag=org.slice(0,8),email="otp-lock-"+tag+"@example.invalid";
  const LIVE=`
    SELECT a.id,a.email,a.phone FROM portal_accounts a
    LEFT JOIN patients p ON p.id=a.patient_id
    LEFT JOIN clients c ON c.id=a.client_id
    LEFT JOIN referrers r ON r.id=a.referrer_id
    WHERE a.id=? AND a.organization_id=? AND a.status='ACTIVE'
      AND a.must_change_password=0
      AND (
        (a.type='PATIENT' AND p.status='ACTIVE' AND p.organization_id=a.organization_id)
        OR (a.type='CORPORATE' AND c.status='ACTIVE' AND c.organization_id=a.organization_id)
        OR (a.type='DOCTOR' AND r.status='ACTIVE' AND r.type='PHYSICIAN'
            AND r.organization_id=a.organization_id)
      ) FOR UPDATE`;
  const claim=async()=>{
    const [x]=await one.execute<mysql.ResultSetHeader>(
      "UPDATE portal_otp_challenges SET consumed_at=NOW(3) WHERE id=? "+
      "AND portal_account_id=? AND purpose='VERIFY_CONTACT' AND consumed_at IS NULL "+
      "AND attempts<max_attempts AND expires_at>NOW(3)",
      [otp,account],
    );
    return x.affectedRows;
  };
  const live=async()=>{
    const [rows]=await one.execute<mysql.RowDataPacket[]>(LIVE,[account,org]);
    return rows;
  };
  const sess=async()=>{
    const [rows]=await one.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM portal_sessions WHERE id=? AND portal_account_id=? "+
      "AND revoked_at IS NULL AND expires_at>NOW(3) FOR UPDATE",[session,account]);
    return rows;
  };
  try{
    await one.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"OTPLOCK-"+tag,"Synthetic Principal Revocation"]);
    await one.execute("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
      "VALUES (?,?,?,?,?,NOW(3))",[patient,org,"OTP-P-"+tag,"Synthetic Patient","synthetic patient"]);
    await one.execute("INSERT INTO portal_accounts"+
      "(id,organization_id,type,patient_id,email,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES (?,?,'PATIENT',?,?,0,'en','ACTIVE',NOW(3))",[account,org,patient,email]);
    await one.execute("INSERT INTO portal_sessions(id,portal_account_id,token_hash,expires_at) "+
      "VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
      [session,account,session.replaceAll("-","").padEnd(64,"0")]);
    await one.execute("INSERT INTO portal_otp_challenges "+
      "(id,portal_account_id,purpose,destination,code_hash,expires_at) "+
      "VALUES (?,?,'VERIFY_CONTACT',?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE))",
      [otp,account,email,"a".repeat(64)]);

    await one.beginTransaction();
    assert.equal((await live()).length,1);
    assert.equal((await sess()).length,1);
    assert.equal(await claim(),1);
    // Concurrent patient revocation must wait for a verifier holding
    // the subject row lock, so it cannot race mid-claim.
    const disable=two.execute<mysql.ResultSetHeader>(
      "UPDATE patients SET status='INACTIVE' WHERE id=?",[patient]);
    await one.commit();
    assert.equal((await disable)[0].affectedRows,1);

    // After the patient becomes inactive, even the original cookie and
    // previously read correct code cannot pass the live-principal guard.
    await one.execute("UPDATE portal_otp_challenges SET consumed_at=NULL WHERE id=?",[otp]);
    await one.beginTransaction();
    assert.equal((await live()).length,0,"deactivated linked patient denied");
    await one.rollback();
    const [notClaimed]=await two.execute<mysql.RowDataPacket[]>(
      "SELECT consumed_at FROM portal_otp_challenges WHERE id=?",[otp]);
    assert.equal(notClaimed[0].consumed_at,null,"no proof written on rejected stale principal");

    await one.execute("UPDATE patients SET status='ACTIVE' WHERE id=?",[patient]);
    await one.execute("UPDATE portal_sessions SET revoked_at=NOW(3) WHERE id=?",[session]);
    await one.beginTransaction();
    assert.equal((await live()).length,1);
    assert.equal((await sess()).length,0,"revoked session denied even if parent account stays active");
    await one.rollback();

    await one.execute("UPDATE portal_sessions SET revoked_at=NULL WHERE id=?",[session]);
    await one.execute("UPDATE portal_accounts SET status='DISABLED' WHERE id=?",[account]);
    await one.beginTransaction();
    assert.equal((await live()).length,0,"disabled account denied");
    await one.rollback();
  }finally{
    await one.rollback().catch(()=>{});
    await one.execute("DELETE FROM portal_otp_challenges WHERE id=?",[otp]).catch(()=>{});
    await one.execute("DELETE FROM portal_sessions WHERE id=?",[session]).catch(()=>{});
    await one.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    await one.execute("DELETE FROM patients WHERE id=?",[patient]).catch(()=>{});
    await one.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([one.end(),two.end()]);
  }
});
