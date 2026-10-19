import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: reception and volume changes serialize against cancellation and closed orders", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [setup, receiver, canceller] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const id = {
    org: randomUUID(), branch: randomUUID(), user: randomUUID(), patient: randomUUID(),
    order: randomUUID(), specimen: randomUUID(),
  };
  const code = id.org.slice(0, 8);
  const undo: Array<{ sql: string; values: string[] }> = [];
  async function put(sql: string, values: string[], removal: string, params: string[]) {
    await setup.execute(sql, values);
    undo.unshift({ sql: removal, values: params });
  }
  const lockOrder = async (conn: typeof receiver) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM orders WHERE id=? AND organization_id=? FOR UPDATE", [id.order,id.org]);
    return rows;
  };
  const getSpecimen = async () => {
    const [rows] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status,remaining_volume,preanalytical_version FROM specimens WHERE id=?", [id.specimen]);
    return rows[0];
  };
  const isLockTimeout = (e: unknown) => Boolean(e && typeof e === "object" &&
    "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT");
  try {
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org,"SOC"+code,"Synthetic specimen order gate"],"DELETE FROM organizations WHERE id=?",[id.org]);
    await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.branch,id.org,"SOC"+code,"Synthetic branch"],"DELETE FROM branches WHERE id=?",[id.branch]);
    await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.user,id.org,"soc"+code,"Synthetic receiver"],"DELETE FROM users WHERE id=?",[id.user]);
    await put("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"SOC"+code,"Synthetic patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?",[id.patient]);
    await put("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id.order,id.org,"SOC"+code,id.branch,id.patient,id.user],
      "DELETE FROM orders WHERE id=?",[id.order]);
    await put("INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,volume,volume_unit,remaining_volume,remaining_volume_unit,updated_at) VALUES(?,?,?,?,1,'COLLECTED',?,3.000,'mL',3.000,'mL',NOW(3))",
      [id.specimen,id.org,id.order,"SOC"+code,id.branch],
      "DELETE FROM specimens WHERE id=?",[id.specimen]);

    await receiver.query("SET SESSION innodb_lock_wait_timeout=1");
    await canceller.query("SET SESSION innodb_lock_wait_timeout=1");

    // Cancellation commits while an operator's form was rendered. The order
    // lock is authoritative; no stale reception/volume write can follow it.
    await canceller.beginTransaction();
    await canceller.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [id.order]);
    await receiver.beginTransaction();
    await assert.rejects(() => lockOrder(receiver), isLockTimeout);
    await receiver.rollback();
    await canceller.commit();

    await receiver.beginTransaction();
    const cancelled = await lockOrder(receiver);
    assert.equal(cancelled[0].status, "CANCELLED");
    assert.equal(["REGISTERED","COLLECTED","IN_PROGRESS"].includes(cancelled[0].status), false);
    await receiver.rollback();
    const untouched = await getSpecimen();
    assert.equal(untouched.status,"COLLECTED");
    assert.equal(untouched.remaining_volume,"3.000");
    assert.equal(untouched.preanalytical_version,0);

    // A completed order is also ineligible, even when its specimen still has
    // the clinical COLLECTED state and available tracked volume.
    await setup.execute("UPDATE orders SET status='COMPLETED' WHERE id=?", [id.order]);
    await receiver.beginTransaction();
    assert.equal((await lockOrder(receiver))[0].status,"COMPLETED");
    await receiver.rollback();
    assert.equal((await getSpecimen()).remaining_volume,"3.000");

    // Reception wins first: cancellation must wait and cannot create an
    // interleaved state between the eligibility decision and specimen update.
    await setup.execute("UPDATE orders SET status='REGISTERED' WHERE id=?", [id.order]);
    await receiver.beginTransaction();
    assert.equal((await lockOrder(receiver))[0].status,"REGISTERED");
    await canceller.beginTransaction();
    await assert.rejects(
      () => canceller.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [id.order]),
      isLockTimeout,
    );
    await canceller.rollback();
    const [received] = await receiver.execute<mysql.ResultSetHeader>(
      "UPDATE specimens SET status='RECEIVED',preanalytical_version=preanalytical_version+1 "+
      "WHERE id=? AND organization_id=? AND status='COLLECTED' AND current_branch_id=? "+
      "AND preanalytical_version=0", [id.specimen,id.org,id.branch]);
    assert.equal(received.affectedRows,1);
    await receiver.commit();
    assert.equal((await getSpecimen()).status,"RECEIVED");

    // The same lock discipline governs volume reconciliation. After a
    // concurrently completed order commits, the volume must not change.
    await canceller.beginTransaction();
    await canceller.execute("UPDATE orders SET status='COMPLETED' WHERE id=?", [id.order]);
    await receiver.beginTransaction();
    await assert.rejects(() => lockOrder(receiver), isLockTimeout);
    await receiver.rollback();
    await canceller.commit();
    await receiver.beginTransaction();
    assert.equal((await lockOrder(receiver))[0].status,"COMPLETED");
    await receiver.rollback();
    assert.equal((await getSpecimen()).remaining_volume,"3.000");
    assert.equal((await getSpecimen()).preanalytical_version,1);
  } finally {
    await receiver.rollback().catch(()=>{});
    await canceller.rollback().catch(()=>{});
    for (const item of undo) await setup.execute(item.sql,item.values).catch(()=>{});
    await Promise.all([setup.end(),receiver.end(),canceller.end()]);
  }
});
