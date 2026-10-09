import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB integration endpoint serialization and outbound CAS delivery claims", { timeout: 45000 }, async () => {
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
  const org = id(), branch = id(), user = id(), endpoint = id();
  const subscription = id(), delivery = id(), message = id();
  const suffix = org.slice(0,8);
  const cleanup: Array<{sql:string; params:string[]}> = [];
  async function seed(sql:string,params:string[],undo:string,values:string[]) {
    await db.execute(sql,params);
    cleanup.unshift({sql:undo,params:values});
  }
  const timeout = (e:unknown) => Boolean(e && typeof e === "object" &&
    "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT");
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"INTEG-"+suffix,"Integration CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"INTEG-"+suffix,"Integration Branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"integ-"+suffix,"Integration Operator"],"DELETE FROM users WHERE id=?",[user]);
    await seed("INSERT INTO integration_endpoints(id,organization_id,branch_id,code,name,endpoint_type,direction,base_url,created_by_user_id,updated_at) VALUES (?,?,?,?,?,'HL7_V2','BIDIRECTIONAL','https://example.org/hook',?,NOW(3))",
      [endpoint,org,branch,"INTEG-"+suffix,"CI Transport",user],
      "DELETE FROM integration_endpoints WHERE id=?",[endpoint]);
    await seed("INSERT INTO webhook_subscriptions(id,organization_id,endpoint_id,event_type,updated_at) VALUES (?,?,?,'diagnostic_report.released',NOW(3))",
      [subscription,org,endpoint],"DELETE FROM webhook_subscriptions WHERE id=?",[subscription]);
    await seed("INSERT INTO webhook_deliveries(id,organization_id,subscription_id,event_type,payload,payload_hash,updated_at) VALUES (?,?,?,'diagnostic_report.released','{}',?,NOW(3))",
      [delivery,org,subscription,"d".repeat(64)],
      "DELETE FROM webhook_deliveries WHERE id=?",[delivery]);
    await seed("INSERT INTO integration_messages(id,organization_id,branch_id,endpoint_id,direction,message_type,control_id,payload_hash,payload_text,updated_at) VALUES (?,?,?,?,'OUTBOUND','ORU^R01','MSH-1',?,'MSH',NOW(3))",
      [message,org,branch,endpoint,"a".repeat(64)],
      "DELETE FROM integration_messages WHERE id=?",[message]);
    await b.query("SET SESSION innodb_lock_wait_timeout=1");

    // The inbound receiver locks the same endpoint before looking up MSH-10.
    // Two simultaneous receivers cannot each decide the control ID is unseen.
    await a.beginTransaction();
    await a.execute("SELECT id FROM integration_endpoints WHERE id=? FOR UPDATE",[endpoint]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM integration_endpoints WHERE id=? FOR UPDATE",[endpoint]),timeout);
    await b.rollback();
    await a.commit();

    // Two dispatchers claim QUEUED -> SENT on the same revision; only one wins.
    const webhookCAS="UPDATE webhook_deliveries SET status='SENT', attempt_count=attempt_count+1,updated_at=NOW(3) WHERE id=? AND status='QUEUED' AND attempt_count=0";
    await a.beginTransaction();
    const [claimed] = await a.execute<mysql.ResultSetHeader>(webhookCAS,[delivery]);
    assert.equal(claimed.affectedRows,1);
    await b.beginTransaction();
    await assert.rejects(b.execute(webhookCAS,[delivery]),timeout);
    await b.rollback();
    await a.commit();
    const [duplicateClaim] = await b.execute<mysql.ResultSetHeader>(webhookCAS,[delivery]);
    assert.equal(duplicateClaim.affectedRows,0);

    // A response from an earlier lease cannot complete a new retry attempt.
    const [staleFinish] = await db.execute<mysql.ResultSetHeader>(
      "UPDATE webhook_deliveries SET status='DELIVERED' WHERE id=? AND status='SENT' AND attempt_count=0",[delivery]);
    assert.equal(staleFinish.affectedRows,0);
    const [finished] = await db.execute<mysql.ResultSetHeader>(
      "UPDATE webhook_deliveries SET status='DELIVERED' WHERE id=? AND status='SENT' AND attempt_count=1",[delivery]);
    assert.equal(finished.affectedRows,1);

    // Two bridge workers cannot both ACK the same outbound message attempt.
    await db.execute("UPDATE integration_messages SET status='SENT',attempt_count=1 WHERE id=?",[message]);
    const ackSql="UPDATE integration_messages SET status='ACKNOWLEDGED' WHERE id=? AND status='SENT' AND attempt_count=1";
    await a.beginTransaction();
    const [firstAck] = await a.execute<mysql.ResultSetHeader>(ackSql,[message]);
    assert.equal(firstAck.affectedRows,1);
    await b.beginTransaction();
    await assert.rejects(b.execute(ackSql,[message]),timeout);
    await b.rollback();
    await a.commit();
    const [secondAck] = await b.execute<mysql.ResultSetHeader>(ackSql,[message]);
    assert.equal(secondAck.affectedRows,0);
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for (const row of cleanup) await db.execute(row.sql,row.params);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
