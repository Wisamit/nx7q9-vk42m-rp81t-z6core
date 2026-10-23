import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 OTP verify: live MariaDB denies a switched linked patient and disabled tenant after pre-read",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for actual MariaDB verification");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [verifier,revoker]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),patientA=randomUUID(),patientB=randomUUID(),account=randomUUID(),otp=randomUUID();
  const tag=org.slice(0,8),destination="otp-bound-"+tag+"@example.invalid";
  const snapshot={type:"PATIENT",patientId:patientA,clientId:null,referrerId:null};
  const sql=`
    SELECT a.id FROM portal_accounts a
    JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'
    LEFT JOIN patients p ON p.id=a.patient_id
    LEFT JOIN clients c ON c.id=a.client_id
    LEFT JOIN referrers r ON r.id=a.referrer_id
    WHERE a.id=? AND a.organization_id=?
      AND a.status='ACTIVE' AND a.must_change_password=0
      AND a.type=?
      AND (
        (a.type='PATIENT' AND p.id=?
          AND p.status='ACTIVE' AND p.organization_id=a.organization_id)
        OR (a.type='CORPORATE' AND c.id=?
          AND c.status='ACTIVE' AND c.organization_id=a.organization_id)
        OR (a.type='DOCTOR' AND r.id=?
          AND r.status='ACTIVE' AND r.type='PHYSICIAN'
          AND r.organization_id=a.organization_id)
      ) FOR UPDATE
  `;
  const attempt=async()=>{
    await verifier.beginTransaction();
    try {
      const [rows]=await verifier.execute<mysql.RowDataPacket[]>(sql,[
        account,org,snapshot.type,snapshot.patientId,snapshot.clientId,snapshot.referrerId,
      ]);
      if(rows.length!==1){await verifier.rollback();return "DENIED";}
      const [claim]=await verifier.execute<mysql.ResultSetHeader>(
        "UPDATE portal_otp_challenges SET consumed_at=NOW(3) WHERE id=? "+
        "AND portal_account_id=? AND purpose='VERIFY_CONTACT' "+
        "AND consumed_at IS NULL AND expires_at>NOW(3) AND attempts<max_attempts",
        [otp,account],
      );
      await verifier.commit();
      return claim.affectedRows===1?"VERIFIED":"DENIED";
    }catch(error){await verifier.rollback().catch(()=>{});throw error;}
  };
  const proof=async()=>{
    const [rows]=await revoker.execute<mysql.RowDataPacket[]>(
      "SELECT consumed_at FROM portal_otp_challenges WHERE id=?",[otp]);
    return rows[0]?.consumed_at;
  };
  try {
    await verifier.execute("INSERT INTO organizations(id,code,name_en,updated_at) "+
      "VALUES(?,?,?,NOW(3))",[org,"OTPBOUND-"+tag,"Synthetic OTP Tenant"]);
    for(const [id,n] of [[patientA,"A"],[patientB,"B"]]){
      await verifier.execute("INSERT INTO patients"+
        "(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
        "VALUES(?,?,?,?,?,NOW(3))",
        [id,org,"OTP-"+tag+"-"+n,"Synthetic Patient "+n,"synthetic patient "+n.toLowerCase()]);
    }
    await verifier.execute("INSERT INTO portal_accounts"+
      "(id,organization_id,type,patient_id,email,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES(?,?,'PATIENT',?,?,0,'en','ACTIVE',NOW(3))",
      [account,org,patientA,destination]);
    await verifier.execute("INSERT INTO portal_otp_challenges "+
      "(id,portal_account_id,purpose,destination,code_hash,expires_at) "+
      "VALUES (?,?,'VERIFY_CONTACT',?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE))",
      [otp,account,destination,"a".repeat(64)]);

    // The challenge was legitimately issued for patient A. After that,
    // a second connection may change the tenant or its linked patient.
    await revoker.execute("UPDATE portal_accounts SET patient_id=? WHERE id=?",[patientB,account]);
    assert.equal(await attempt(),"DENIED",
      "switching to another ACTIVE patient must not verify the old principal");
    assert.equal(await proof(),null);

    await revoker.execute("UPDATE portal_accounts SET patient_id=? WHERE id=?",[patientA,account]);
    await revoker.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[org]);
    assert.equal(await attempt(),"DENIED","tenant revocation denies stale valid OTP");
    assert.equal(await proof(),null);

    await revoker.execute("UPDATE organizations SET status='ACTIVE' WHERE id=?",[org]);
    await revoker.execute("UPDATE portal_accounts SET type='CORPORATE',patient_id=NULL WHERE id=?",[account]);
    assert.equal(await attempt(),"DENIED","changing account type must not reuse patient OTP");
    assert.equal(await proof(),null);

    await revoker.execute("UPDATE portal_accounts SET type='PATIENT',patient_id=? WHERE id=?",[patientA,account]);
    assert.equal(await attempt(),"VERIFIED","original unchanged active subject may verify");
    assert.ok(await proof(),"only valid, same-principal claim consumes code");
  }finally{
    await verifier.rollback().catch(()=>{});
    await verifier.execute("DELETE FROM portal_otp_challenges WHERE id=?",[otp]).catch(()=>{});
    await verifier.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    for(const id of [patientA,patientB])
      await verifier.execute("DELETE FROM patients WHERE id=?",[id]).catch(()=>{});
    await verifier.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([verifier.end(),revoker.end()]);
  }
});
