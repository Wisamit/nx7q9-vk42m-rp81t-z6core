import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("F7 OTP: actual MariaDB CAS enforces attempt budget, expiry and single use under concurrent connections",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for real MariaDB OTP test");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [one,two]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const organizationId=randomUUID(),portalId=randomUUID();
  const challenges:string[]=[];
  const token=randomUUID().slice(0,8);
  const codeHash="synthetic-otp-hash";
  const destination="otp-"+token+"@example.invalid";

  async function create(expiresMinutes:number,maxAttempts:number){
    const id=randomUUID();
    await one.execute(
      "INSERT INTO portal_otp_challenges (id,portal_account_id,purpose,destination,code_hash,"+
      "attempts,max_attempts,expires_at) VALUES (?,?,'VERIFY_CONTACT',?,?,0,?,DATE_ADD(NOW(3),INTERVAL ? MINUTE))",
      [id,portalId,destination,codeHash,maxAttempts,expiresMinutes],
    );
    challenges.push(id);
    return id;
  }
  async function claim(conn:typeof one,id:string,kind:"wrong"|"correct") {
    const update=kind==="wrong"
      ? "UPDATE portal_otp_challenges SET attempts=attempts+1"
      : "UPDATE portal_otp_challenges SET consumed_at=NOW(3)";
    const [result]=await conn.execute<mysql.ResultSetHeader>(
      update+" WHERE id=? AND portal_account_id=? AND purpose='VERIFY_CONTACT' "+
      "AND code_hash=? AND destination=? AND consumed_at IS NULL "+
      "AND expires_at>NOW(3) AND attempts<max_attempts",
      [id,portalId,codeHash,destination],
    );
    return result.affectedRows;
  }
  async function read(id:string){
    const [rows]=await one.execute<mysql.RowDataPacket[]>(
      "SELECT attempts,max_attempts,consumed_at FROM portal_otp_challenges WHERE id=?",[id]);
    return rows[0];
  }

  try {
    await one.execute("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [organizationId,"OTPCAS-"+token,"Synthetic OTP Tenant"]);
    await one.execute(
      "INSERT INTO portal_accounts (id,organization_id,type,preferred_locale,status,updated_at) "+
      "VALUES (?,?,'PATIENT','en','ACTIVE',NOW(3))",
      [portalId,organizationId]);

    // Two incorrect guesses against a one-try challenge MUST spend at most one attempt.
    const limited=await create(10,1);
    const twoWrong=await Promise.all([claim(one,limited,"wrong"),claim(two,limited,"wrong")]);
    assert.equal(twoWrong.reduce((a,b)=>a+b,0),1,"max attempt count cannot be exceeded");
    assert.equal((await read(limited)).attempts,1);
    assert.equal(await claim(one,limited,"correct"),0,"correct OTP denied after budget exhausted");

    // Two correct requests consume exactly once; later guesses cannot modify spent OTP.
    const once=await create(10,5);
    const twice=await Promise.all([claim(one,once,"correct"),claim(two,once,"correct")]);
    assert.equal(twice.reduce((a,b)=>a+b,0),1,"only one successful verification receipt");
    assert.ok((await read(once)).consumed_at);
    assert.equal(await claim(two,once,"wrong"),0);

    // Expired challenge must reject both paths, even when a pre-read was valid.
    const expired=await create(-1,5);
    assert.equal(await claim(one,expired,"correct"),0);
    assert.equal(await claim(two,expired,"wrong"),0);
    assert.equal((await read(expired)).attempts,0);

    // Bound to the exact hashed challenge/destination snapshot.
    const rotated=await create(10,5);
    const [mismatch]=await two.execute<mysql.ResultSetHeader>(
      "UPDATE portal_otp_challenges SET consumed_at=NOW(3) WHERE id=? "+
      "AND portal_account_id=? AND code_hash=? AND destination=? "+
      "AND consumed_at IS NULL AND expires_at>NOW(3) AND attempts<max_attempts",
      [rotated,portalId,"previous-stale-hash",destination]);
    assert.equal(mismatch.affectedRows,0);
    assert.equal((await read(rotated)).consumed_at,null);
  } finally {
    for(const id of challenges){
      await one.execute("DELETE FROM portal_otp_challenges WHERE id=?",[id]).catch(()=>{});
    }
    await one.execute("DELETE FROM portal_accounts WHERE id=?",[portalId]).catch(()=>{});
    await one.execute("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await Promise.all([one.end(),two.end()]);
  }
});
