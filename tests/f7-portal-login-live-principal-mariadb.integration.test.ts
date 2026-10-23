import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 login: a subject deactivated after password pre-read cannot create session or lockout",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for real MariaDB");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [auth,admin]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const org=randomUUID(),patient=randomUUID(),account=randomUUID();
  const tag=org.slice(0,8);
  const sessionIds:string[]=[];

  async function attemptLogin(snapshotPatient=patient,createSession=true){
    await auth.beginTransaction();
    try {
      const [locked]=await auth.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM portal_accounts WHERE id=? AND organization_id=? FOR UPDATE",
        [account,org]);
      if(locked.length!==1){await auth.rollback();return false;}
      const [live]=await auth.execute<mysql.RowDataPacket[]>(
        "SELECT a.id FROM portal_accounts a "+
        "JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE' "+
        "LEFT JOIN patients p ON p.id=a.patient_id "+
        "LEFT JOIN clients c ON c.id=a.client_id "+
        "LEFT JOIN referrers r ON r.id=a.referrer_id "+
        "WHERE a.id=? AND a.organization_id=? "+
        "AND a.status IN ('ACTIVE','LOCKED') AND a.type='PATIENT' "+
        "AND ((a.type='PATIENT' AND p.id=? AND p.status='ACTIVE' "+
        "AND p.organization_id=a.organization_id) "+
        "OR (a.type='CORPORATE' AND c.status='ACTIVE' "+
        "AND c.organization_id=a.organization_id) "+
        "OR (a.type='DOCTOR' AND r.status='ACTIVE' AND r.type='PHYSICIAN' "+
        "AND r.organization_id=a.organization_id)) FOR UPDATE",
        [account,org,snapshotPatient],
      );
      if(live.length!==1){await auth.rollback();return false;}
      if(createSession){
        const id=randomUUID();sessionIds.push(id);
        const tokenHash=createHash("sha256").update(id).digest("hex");
        await auth.execute(
          "INSERT INTO portal_sessions (id,portal_account_id,token_hash,expires_at) "+
          "VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 12 HOUR))",[id,account,tokenHash]);
      }else{
        await auth.execute("UPDATE portal_accounts SET failed_login_attempts=failed_login_attempts+1 WHERE id=?",[account]);
      }
      await auth.commit();
      return true;
    }catch(e){await auth.rollback().catch(()=>{});throw e;}
  }
  async function counts(){
    const [sessions]=await auth.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM portal_sessions WHERE portal_account_id=?",[account]);
    const [attempts]=await auth.execute<mysql.RowDataPacket[]>(
      "SELECT failed_login_attempts FROM portal_accounts WHERE id=?",[account]);
    return {sessions:Number(sessions[0].n),attempts:Number(attempts[0].failed_login_attempts)};
  }
  try{
    await auth.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"LOGIN-SUB-"+tag,"Synthetic Login Subject Tenant"]);
    await auth.execute("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
      "VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"LOGSUB-"+tag,"Synthetic Login Patient","synthetic login patient"]);
    await auth.execute("INSERT INTO portal_accounts"+
      "(id,organization_id,type,patient_id,normalized_email,password_hash,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES(?,?,'PATIENT',?,?,'synthetic-bcrypt-hash',0,'en','ACTIVE',NOW(3))",
      [account,org,patient,"login-"+tag+"@example.invalid"]);

    assert.equal(await attemptLogin(),true,"valid linked patient can sign in");
    assert.equal((await counts()).sessions,1);
    await admin.execute("UPDATE patients SET status='INACTIVE' WHERE id=?",[patient]);
    assert.equal(await attemptLogin(),false,"patient disabled during bcrypt cannot create session");
    assert.equal(await attemptLogin(patient,false),false,"cannot apply failed-login lockout to disabled patient");
    assert.deepEqual(await counts(),{sessions:1,attempts:0});
    await admin.execute("UPDATE patients SET status='ACTIVE' WHERE id=?",[patient]);
    assert.equal(await attemptLogin(randomUUID()),false,
      "a changed patient FK since pre-hash snapshot cannot create session");
    await admin.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[org]);
    assert.equal(await attemptLogin(),false,"inactive organization cannot authenticate");
    assert.deepEqual(await counts(),{sessions:1,attempts:0});
    await admin.execute("UPDATE organizations SET status='ACTIVE' WHERE id=?",[org]);
    assert.equal(await attemptLogin(patient,false),true,"valid linked patient may consume one wrong attempt");
    assert.deepEqual(await counts(),{sessions:1,attempts:1});
  }finally{
    for(const id of sessionIds)await auth.execute("DELETE FROM portal_sessions WHERE id=?",[id]).catch(()=>{});
    await auth.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    await auth.execute("DELETE FROM patients WHERE id=?",[patient]).catch(()=>{});
    await auth.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([auth.end(),admin.end()]);
  }
});
