import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

/** Concurrent independent MariaDB connections test the parent-row FOR UPDATE. */
test("F7 OTP issue: simultaneous replacements leave exactly one unconsumed challenge",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [a,b]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const organizationId=randomUUID(),accountId=randomUUID(),tag=organizationId.slice(0,8);
  const dest=`otp-race-${tag}@example.invalid`;
  const challengeIds:string[]=[];

  async function issue(conn:typeof a,suffix:string,expectedDestination=dest) {
    await conn.beginTransaction();
    try {
      const [rows]=await conn.execute<mysql.RowDataPacket[]>(
        "SELECT id,email,must_change_password FROM portal_accounts WHERE id=? "+
        "AND organization_id=? AND status='ACTIVE' FOR UPDATE",[accountId,organizationId]);
      if(rows.length!==1 || rows[0].must_change_password ||
        rows[0].email?.trim()!==expectedDestination) {
        await conn.rollback();
        return "DENIED";
      }
      await conn.execute(
        "UPDATE portal_otp_challenges SET consumed_at=NOW(3) "+
        "WHERE portal_account_id=? AND purpose='VERIFY_CONTACT' AND consumed_at IS NULL",
        [accountId],
      );
      const id=randomUUID();
      await conn.execute("INSERT INTO portal_otp_challenges "+
        "(id,portal_account_id,purpose,destination,code_hash,expires_at) "+
        "VALUES (?,?,'VERIFY_CONTACT',?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE))",
        [id,accountId,expectedDestination,"synthetic-code-hash-"+suffix]);
      challengeIds.push(id);
      await conn.commit();
      return id;
    } catch(error){
      await conn.rollback().catch(()=>{});
      throw error;
    }
  }
  try {
    await a.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [organizationId,"OTPREPL-"+tag,"Synthetic OTP Replacement"]);
    await a.execute("INSERT INTO portal_accounts"+
      "(id,organization_id,type,email,must_change_password,preferred_locale,status,updated_at) "+
      "VALUES (?,?,'PATIENT',?,0,'en','ACTIVE',NOW(3))",[accountId,organizationId,dest]);

    const results=await Promise.all([issue(a,"one"),issue(b,"two")]);
    assert.equal(results.filter(r=>r!=="DENIED").length,2);
    const [rows]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT id,consumed_at FROM portal_otp_challenges WHERE portal_account_id=?",
      [accountId],
    );
    assert.equal(rows.length,2);
    assert.equal(rows.filter(r=>r.consumed_at===null).length,1,
      "overlapping OTP requests cannot leave two valid codes");
    assert.equal(rows.filter(r=>r.consumed_at!==null).length,1,
      "later serialized request must revoke the earlier challenge");

    await a.execute("UPDATE portal_accounts SET email=? WHERE id=?",
      ["rotated-"+dest,accountId]);
    assert.equal(await issue(b,"stale"),"DENIED",
      "stale snapshot cannot issue OTP to previously assigned email");
    const [after]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS active_count FROM portal_otp_challenges "+
      "WHERE portal_account_id=? AND consumed_at IS NULL",[accountId]);
    assert.equal(Number(after[0].active_count),1);
  }finally{
    for(const id of challengeIds)await a.execute("DELETE FROM portal_otp_challenges WHERE id=?",[id]).catch(()=>{});
    await a.execute("DELETE FROM portal_accounts WHERE id=?",[accountId]).catch(()=>{});
    await a.execute("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await Promise.all([a.end(),b.end()]);
  }
});
