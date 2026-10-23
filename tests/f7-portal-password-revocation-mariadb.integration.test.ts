import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

/** Direct two-connection MariaDB race; do not simulate row locks in memory. */
test("F7 password change: keeps current session, revokes others and cannot reactivate disabled account",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for portal password race test");
  const u=new URL(process.env.DATABASE_URL);
  const options={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [first,second]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const org=randomUUID(),account=randomUUID(),currentSession=randomUUID(),otherSession=randomUUID();
  const tag=org.slice(0,8),originalHash="synthetic-original-password-hash",newHash="synthetic-new-password-hash";
  const tokenHash=(id:string)=>id.replaceAll("-","").padEnd(64,"0");
  try {
    await first.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"PPWCAS-"+tag,"Synthetic Portal Password Tenant"]);
    await first.execute("INSERT INTO portal_accounts(id,organization_id,type,password_hash,"+
      "must_change_password,preferred_locale,status,updated_at) "+
      "VALUES (?,?,'PATIENT',?,1,'en','ACTIVE',NOW(3))",
      [account,org,originalHash]);
    for(const id of [currentSession,otherSession]){
      await first.execute("INSERT INTO portal_sessions "+
        "(id,portal_account_id,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
        [id,account,tokenHash(id)]);
    }

    // Account lock serializes a concurrent administrative DISABLED transition.
    await first.beginTransaction();
    const [locked]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status FROM portal_accounts WHERE id=? AND organization_id=? FOR UPDATE",
      [account,org]);
    assert.equal(locked.length,1);
    assert.equal(locked[0].status,"ACTIVE");
    const [liveSession]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM portal_sessions WHERE id=? AND portal_account_id=? "+
      "AND revoked_at IS NULL AND expires_at>NOW(3)",[currentSession,account]);
    assert.equal(liveSession.length,1);

    const [changed]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE portal_accounts SET password_hash=?,must_change_password=0 "+
      "WHERE id=? AND organization_id=? AND status='ACTIVE'",
      [newHash,account,org]);
    assert.equal(changed.affectedRows,1);
    const [revoked]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE portal_sessions SET revoked_at=NOW(3) WHERE portal_account_id=? "+
      "AND id<>? AND revoked_at IS NULL",[account,currentSession]);
    assert.equal(revoked.affectedRows,1);

    // This UPDATE must wait for the change transaction. Once it succeeds,
    // the account MUST remain disabled, not be reactivated by the password endpoint.
    const concurrentDisable=second.execute<mysql.ResultSetHeader>(
      "UPDATE portal_accounts SET status='DISABLED' WHERE id=?",[account]);
    await first.commit();
    const [disabled]=await concurrentDisable;
    assert.equal(disabled.affectedRows,1);

    const [sessions]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,revoked_at FROM portal_sessions WHERE portal_account_id=?",[account]);
    assert.equal(sessions.find(s=>s.id===currentSession)?.revoked_at,null);
    assert.ok(sessions.find(s=>s.id===otherSession)?.revoked_at);

    // A stale cookie from before disable cannot start another password
    // rotation or set status=ACTIVE. The current state wins.
    await first.beginTransaction();
    const [afterDisable]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT status,password_hash,must_change_password FROM portal_accounts "+
      "WHERE id=? AND organization_id=? FOR UPDATE",[account,org]);
    assert.equal(afterDisable[0].status,"DISABLED");
    assert.equal(afterDisable[0].password_hash,newHash);
    assert.equal(afterDisable[0].must_change_password,0);
    await first.rollback();

    const [cannotForce]=await second.execute<mysql.ResultSetHeader>(
      "UPDATE portal_accounts SET password_hash=? WHERE id=? "+
      "AND organization_id=? AND status='ACTIVE'",
      ["should-never-apply",account,org]);
    assert.equal(cannotForce.affectedRows,0);
    const [final]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT status,password_hash FROM portal_accounts WHERE id=?",[account]);
    assert.equal(final[0].status,"DISABLED");
    assert.equal(final[0].password_hash,newHash);
  } finally {
    await first.rollback().catch(()=>{});
    await first.execute("DELETE FROM portal_sessions WHERE portal_account_id=?",[account]).catch(()=>{});
    await first.execute("DELETE FROM portal_accounts WHERE id=?",[account]).catch(()=>{});
    await first.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
