import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: new transfer dispatch serializes with cancellation; already shipped custody remains receivable", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [setup, dispatcher, canceller] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const id = {
    org: randomUUID(), source: randomUUID(), destination: randomUUID(), user: randomUUID(),
    patient: randomUUID(), order: randomUUID(), specimen: randomUUID(), manifest: randomUUID(),
  };
  const tag = id.org.slice(0, 8);
  const cleanup: Array<{ sql: string; params: string[] }> = [];
  async function insert(sql: string, params: string[], undo: string, ids: string[]) {
    await setup.execute(sql, params);
    cleanup.unshift({ sql: undo, params: ids });
  }
  const lockOrder = async (conn: typeof dispatcher) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM orders WHERE id=? AND organization_id=? FOR UPDATE", [id.order, id.org]);
    return rows;
  };
  const lockTimeout = (error: unknown) => Boolean(error && typeof error === "object" &&
    "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT");
  try {
    await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org,"TCL"+tag,"Synthetic transfer guard"],"DELETE FROM organizations WHERE id=?",[id.org]);
    for (const [branch, code] of [[id.source, "A"], [id.destination, "B"]]) {
      await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch,id.org,"TCL"+code+tag,"Synthetic transfer branch"],
        "DELETE FROM branches WHERE id=?",[branch]);
    }
    await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.user,id.org,"tcl"+tag,"Synthetic courier"],"DELETE FROM users WHERE id=?",[id.user]);
    await insert("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"TCL"+tag,"Synthetic Patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?",[id.patient]);
    await insert("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id.order,id.org,"TCL"+tag,id.source,id.patient,id.user],
      "DELETE FROM orders WHERE id=?",[id.order]);
    await insert("INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES(?,?,?,?,1,'COLLECTED',?,NOW(3))",
      [id.specimen,id.org,id.order,"TCL"+tag,id.source],
      "DELETE FROM specimens WHERE id=?",[id.specimen]);
    await insert("INSERT INTO specimen_transfer_manifests(id,organization_id,manifest_number,source_branch_id,destination_branch_id,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,'DRAFT',?,NOW(3))",
      [id.manifest,id.org,"TCL"+tag,id.source,id.destination,id.user],
      "DELETE FROM specimen_transfer_manifests WHERE id=?",[id.manifest]);
    await insert("INSERT INTO specimen_transfer_items(manifest_id,specimen_id,barcode_snapshot,status) VALUES(?,?,?,'PLANNED')",
      [id.manifest,id.specimen,"TCL"+tag],
      "DELETE FROM specimen_transfer_items WHERE manifest_id=? AND specimen_id=?",
      [id.manifest,id.specimen]);

    await dispatcher.query("SET SESSION innodb_lock_wait_timeout=1");
    await canceller.query("SET SESSION innodb_lock_wait_timeout=1");

    // A previously loaded DRAFT is not enough to dispatch: order cancellation
    // holds the same canonical row and wins before the dispatch transaction.
    await canceller.beginTransaction();
    await canceller.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [id.order]);
    await dispatcher.beginTransaction();
    await assert.rejects(() => lockOrder(dispatcher),lockTimeout);
    await dispatcher.rollback();
    await canceller.commit();
    await dispatcher.beginTransaction();
    assert.equal((await lockOrder(dispatcher))[0].status,"CANCELLED");
    await dispatcher.rollback();
    const [stale] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT m.status AS manifest_status,t.status AS item_status,s.status AS specimen_status FROM specimen_transfer_manifests m "+
      "JOIN specimen_transfer_items t ON t.manifest_id=m.id JOIN specimens s ON s.id=t.specimen_id WHERE m.id=?",
      [id.manifest]);
    assert.equal(stale[0].manifest_status,"DRAFT");
    assert.equal(stale[0].item_status,"PLANNED");
    assert.equal(stale[0].specimen_status,"COLLECTED");

    // Completed orders also disallow a new dispatch without moving custody.
    await setup.execute("UPDATE orders SET status='COMPLETED' WHERE id=?", [id.order]);
    await dispatcher.beginTransaction();
    assert.equal((await lockOrder(dispatcher))[0].status,"COMPLETED");
    await dispatcher.rollback();

    // When dispatch wins first the cancellation must serialize and wait.
    await setup.execute("UPDATE orders SET status='REGISTERED' WHERE id=?", [id.order]);
    await dispatcher.beginTransaction();
    assert.equal((await lockOrder(dispatcher))[0].status,"REGISTERED");
    await canceller.beginTransaction();
    await assert.rejects(() => canceller.execute(
      "UPDATE orders SET status='CANCELLED' WHERE id=?",[id.order]),lockTimeout);
    await canceller.rollback();
    const [claim] = await dispatcher.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_transfer_manifests SET status='DISPATCHED' WHERE id=? AND organization_id=? AND status='DRAFT'",
      [id.manifest,id.org]);
    assert.equal(claim.affectedRows,1);
    const [item] = await dispatcher.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_transfer_items SET status='DISPATCHED' WHERE manifest_id=? AND status='PLANNED'",
      [id.manifest]);
    assert.equal(item.affectedRows,1);
    const [specimen] = await dispatcher.execute<mysql.ResultSetHeader>(
      "UPDATE specimens SET status='IN_TRANSIT',preanalytical_version=preanalytical_version+1 "+
      "WHERE id=? AND organization_id=? AND status='COLLECTED' AND current_branch_id=? AND preanalytical_version=0",
      [id.specimen,id.org,id.source]);
    assert.equal(specimen.affectedRows,1);
    await dispatcher.commit();

    // The clinical order may later be cancelled. A physically in-transit
    // specimen must still be receivable: custody is not clinical analysis.
    await setup.execute("UPDATE orders SET status='CANCELLED' WHERE id=?",[id.order]);
    await dispatcher.beginTransaction();
    const [receipt] = await dispatcher.execute<mysql.ResultSetHeader>(
      "UPDATE specimens SET status='RECEIVED',current_branch_id=?,preanalytical_version=preanalytical_version+1 "+
      "WHERE id=? AND organization_id=? AND status='IN_TRANSIT' AND current_branch_id=? AND preanalytical_version=1",
      [id.destination,id.specimen,id.org,id.source]);
    assert.equal(receipt.affectedRows,1);
    await dispatcher.execute(
      "UPDATE specimen_transfer_items SET status='RECEIVED' WHERE manifest_id=? AND specimen_id=? AND status='DISPATCHED'",
      [id.manifest,id.specimen]);
    await dispatcher.execute("UPDATE specimen_transfer_manifests SET status='RECEIVED' WHERE id=?",[id.manifest]);
    await dispatcher.commit();
    const [arrived] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status,current_branch_id FROM specimens WHERE id=?",[id.specimen]);
    assert.equal(arrived[0].status,"RECEIVED");
    assert.equal(arrived[0].current_branch_id,id.destination);
  } finally {
    await dispatcher.rollback().catch(()=>{});
    await canceller.rollback().catch(()=>{});
    for(const row of cleanup) await setup.execute(row.sql,row.params).catch(()=>{});
    await Promise.all([setup.end(),dispatcher.end(),canceller.end()]);
  }
});
