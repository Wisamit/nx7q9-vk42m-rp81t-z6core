import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB appointment, home collection, and queue transitions remain atomic", { timeout: 50000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [db, a, b] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const id = () => randomUUID();
  const org = id(), branch = id(), user = id(), patient = id();
  const appointment = id(), visit = id(), queue = id(), portalAccount = id(), portalSession = id();
  const short = org.slice(0, 8);
  const cleanup: Array<{ sql: string; params: string[] }> = [];
  const seed = async (sql: string, params: string[], undo: string, values: string[]) => {
    await db.execute(sql, params);
    cleanup.unshift({ sql: undo, params: values });
  };
  const isLockTimeout = (err: unknown) =>
    Boolean(err && typeof err === "object" && "code" in err && err.code === "ER_LOCK_WAIT_TIMEOUT");

  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"DIG-"+short,"Digital CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"DIG-"+short,"Digital Branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"dig-"+short,"Reception"],"DELETE FROM users WHERE id=?",[user]);
    await seed("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"DIG-"+short,"Integration Patient","integration patient"],
      "DELETE FROM patients WHERE id=?",[patient]);
    await seed("INSERT INTO appointments(id,organization_id,branch_id,patient_id,appointment_number,mode,service_name_snapshot,scheduled_start,status,updated_at) VALUES (?,?,?,?,?,'HOME_COLLECTION','Blood draw',DATE_ADD(NOW(3), INTERVAL 1 DAY),'CONFIRMED',NOW(3))",
      [appointment,org,branch,patient,"DIG-"+short],
      "DELETE FROM appointments WHERE id=?",[appointment]);
    await seed("INSERT INTO home_collection_visits(id,appointment_id,branch_id,status,updated_at) VALUES (?,?,?,'SCHEDULED',NOW(3))",
      [visit,appointment,branch],"DELETE FROM home_collection_visits WHERE id=?",[visit]);
    await seed("INSERT INTO queue_tickets(id,organization_id,branch_id,patient_id,appointment_id,ticket_number,queue_date,sequence,stage,issued_by_user_id,updated_at) VALUES (?,?,?,?,?,'R001',CURRENT_DATE(),1,'RECEPTION',?,NOW(3))",
      [queue,org,branch,patient,appointment,user],"DELETE FROM queue_tickets WHERE id=?",[queue]);
    await seed("INSERT INTO portal_accounts(id,organization_id,type,patient_id,status,password_hash,updated_at) VALUES (?,?,'PATIENT',?,'ACTIVE','locked-pass',NOW(3))",
      [portalAccount,org,patient],"DELETE FROM portal_accounts WHERE id=?",[portalAccount]);
    await seed("INSERT INTO portal_sessions(id,portal_account_id,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(NOW(3), INTERVAL 1 HOUR))",
      [portalSession,portalAccount,"c".repeat(64)],"DELETE FROM portal_sessions WHERE id=?",[portalSession]);
    await b.query("SET SESSION innodb_lock_wait_timeout = 1");

    // Cancelling an appointment cannot race home collection events.
    await a.beginTransaction();
    await a.execute("SELECT id FROM appointments WHERE id=? AND organization_id=? FOR UPDATE",[appointment,org]);
    await a.execute("UPDATE appointments SET status='CANCELLED',cancelled_at=NOW(3) WHERE id=? AND status='CONFIRMED'",[appointment]);
    await a.execute("UPDATE home_collection_visits SET status='CANCELLED' WHERE id=? AND status='SCHEDULED'",[visit]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM appointments WHERE id=? FOR UPDATE",[appointment]),isLockTimeout);
    await b.rollback();
    await a.commit();
    const [cancelled] = await b.execute<mysql.RowDataPacket[]>(
      "SELECT a.status appointment_status, h.status visit_status FROM appointments a JOIN home_collection_visits h ON h.appointment_id=a.id WHERE a.id=?",[appointment]);
    assert.equal(cancelled[0]?.appointment_status,"CANCELLED");
    assert.equal(cancelled[0]?.visit_status,"CANCELLED");
    // A cancelled appointment cannot be checked in or completed by a stale request.
    const [wrong] = await b.execute<mysql.ResultSetHeader>(
      "UPDATE appointments SET status='CHECKED_IN' WHERE id=? AND status='CONFIRMED'",[appointment]);
    assert.equal(wrong.affectedRows,0);

    // Two operators claiming a queue transition cannot both succeed.
    await a.beginTransaction();
    const [first] = await a.execute<mysql.ResultSetHeader>(
      "UPDATE queue_tickets SET status='CALLED' WHERE id=? AND status='WAITING'",[queue]);
    assert.equal(first.affectedRows,1);
    await b.beginTransaction();
    await assert.rejects(b.execute(
      "UPDATE queue_tickets SET status='CALLED' WHERE id=? AND status='WAITING'",[queue]),isLockTimeout);
    await b.rollback();
    await a.commit();
    const [second] = await b.execute<mysql.ResultSetHeader>(
      "UPDATE queue_tickets SET status='CALLED' WHERE id=? AND status='WAITING'",[queue]);
    assert.equal(second.affectedRows,0);

    // Admin disabling a portal account must exclude a concurrent login and revoke sessions.
    await a.beginTransaction();
    await a.execute("SELECT id FROM portal_accounts WHERE id=? FOR UPDATE",[portalAccount]);
    await a.execute("UPDATE portal_accounts SET status='DISABLED',deactivated_at=NOW(3) WHERE id=?",[portalAccount]);
    await a.execute("UPDATE portal_sessions SET revoked_at=NOW(3) WHERE portal_account_id=? AND revoked_at IS NULL",[portalAccount]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM portal_accounts WHERE id=? FOR UPDATE",[portalAccount]),isLockTimeout);
    await b.rollback();
    await a.commit();
    const [deactivated] = await b.execute<mysql.RowDataPacket[]>(
      "SELECT a.status, s.revoked_at FROM portal_accounts a JOIN portal_sessions s ON s.portal_account_id=a.id WHERE a.id=?",[portalAccount]);
    assert.equal(deactivated[0]?.status,"DISABLED");
    assert.ok(deactivated[0]?.revoked_at);
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for (const item of cleanup) await db.execute(item.sql,item.params);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
