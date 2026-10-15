import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Two connections are mandatory: InnoDB lock serialization and stale CAS. */
test("Stage 137 MariaDB: replay cannot overwrite a concurrently advanced analyzer message", { timeout: 45000 }, async () => {
  const urlText = process.env.DATABASE_URL;
  if (!urlText) throw new Error("DATABASE_URL required for Stage137 concurrency test");
  const u = new URL(urlText);
  const options = { host: u.hostname, port: Number(u.port || 3306),
    database: u.pathname.slice(1), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password) };
  const [setup, first, second] = await Promise.all([
    mysql.createConnection(options), mysql.createConnection(options), mysql.createConnection(options),
  ]);
  const org = randomUUID(), otherOrg = randomUUID(), branch = randomUUID(),
    analyzer = randomUUID(), message = randomUUID(), suffix = org.slice(0, 8);
  const removals: Array<{ sql: string; args: string[] }> = [];
  async function seed(sql: string, args: string[], undo: string, undoArgs: string[]) {
    await setup.execute(sql, args);
    removals.unshift({ sql: undo, args: undoArgs });
  }
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org, "S137" + suffix, "Stage 137 Analyzer Lab"], "DELETE FROM organizations WHERE id=?", [org]);
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [otherOrg, "X137" + suffix, "Foreign Analyzer Lab"], "DELETE FROM organizations WHERE id=?", [otherOrg]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S137"+suffix,"Stage 137 Branch"], "DELETE FROM branches WHERE id=?", [branch]);
    await seed("INSERT INTO analyzers(id,organization_id,branch_id,code,name,protocol,transport,updated_at) VALUES(?,?,?,?,?,'HL7_V2','TCP_SERVER',NOW(3))",
      [analyzer,org,branch,"S137"+suffix,"Stage 137 Analyzer"],
      "DELETE FROM analyzers WHERE id=?", [analyzer]);
    await seed("INSERT INTO analyzer_messages(id,analyzer_id,branch_id,direction,protocol,bridge_message_id,payload_hash,raw_payload,status,attempts,error_code,updated_at) VALUES(?,?,?,'INBOUND','HL7_V2',?,?,?,'ERROR',1,'E_TEST',NOW(3))",
      [message,analyzer,branch,"S137"+suffix,"a".repeat(64),"SYNTHETIC FRAME"],
      "DELETE FROM analyzer_messages WHERE id=?", [message]);

    const [initial] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at, attempts FROM analyzer_messages WHERE id=?",[message]);
    const version = initial[0]?.updated_at as Date;
    const initialAttempts = initial[0]?.attempts as number;
    assert.equal(initialAttempts, 1);

    const claimSql = "UPDATE analyzer_messages SET status='RECEIVED',attempts=attempts+1,error_code=NULL,error_text=NULL,processed_at=NULL,updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) "+
      "WHERE id=? AND status IN('ERROR','DEAD_LETTER') AND updated_at=? AND attempts=?";
    await first.beginTransaction();
    const [firstClaim] = await first.execute<mysql.ResultSetHeader>(claimSql,[message,version,initialAttempts]);
    assert.equal(firstClaim.affectedRows,1);
    await second.query("SET SESSION innodb_lock_wait_timeout=1");
    await second.beginTransaction();
    await assert.rejects(second.execute<mysql.ResultSetHeader>(claimSql,[message,version,initialAttempts]),
      (error:unknown)=>Boolean(error && typeof error==="object" && "code" in error &&
        error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();
    const [stale] = await second.execute<mysql.ResultSetHeader>(claimSql,[message,version,initialAttempts]);
    assert.equal(stale.affectedRows,0,"stale API read cannot claim a recovered message");
    await setup.execute("UPDATE analyzer_messages SET status='PROCESSED',updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id=?",
      [message]);
    const [late] = await second.execute<mysql.ResultSetHeader>(claimSql,[message,version,initialAttempts]);
    assert.equal(late.affectedRows,0,"manual replay must never requeue a processed message");
    const [final] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status, attempts FROM analyzer_messages WHERE id=?",[message]);
    assert.deepEqual([final[0].status,final[0].attempts],["PROCESSED",2]);

    // Tenant is immutable through the analyzer FK. Even if a second actor
    // guesses the UUID, their organization-scoped claim cannot touch it.
    const [otherTenant] = await second.execute<mysql.ResultSetHeader>(
      "UPDATE analyzer_messages m JOIN analyzers a ON a.id=m.analyzer_id SET m.status='RECEIVED' "+
      "WHERE m.id=? AND a.organization_id=? AND m.status IN('ERROR','DEAD_LETTER')",
      [message,otherOrg]);
    assert.equal(otherTenant.affectedRows,0);
  } finally {
    await Promise.all([first.rollback().catch(()=>{}),second.rollback().catch(()=>{})]);
    for(const entry of removals) await setup.execute(entry.sql,entry.args);
    await Promise.all([setup.end(),first.end(),second.end()]);
  }
});
