import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: result entry cannot claim closed order/item even when initial view was stale", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [db, clinician, canceller] = await Promise.all([
    mysql.createConnection(cfg), mysql.createConnection(cfg), mysql.createConnection(cfg),
  ]);
  const id = {
    org: randomUUID(), branch: randomUUID(), patient: randomUUID(),
    user: randomUUID(), test: randomUUID(), order: randomUUID(), item: randomUUID(),
  };
  const suffix = id.org.slice(0,8);
  const undo: Array<{sql: string; values: string[]}> = [];
  async function seed(sql: string, values: string[], undoSql: string, ids: string[]) {
    await db.execute(sql, values);
    undo.unshift({sql:undoSql,values:ids});
  }
  async function lockOrder(conn: typeof clinician) {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM orders WHERE id=? AND organization_id=? FOR UPDATE",
      [id.order,id.org]);
    return rows;
  }
  async function lockItem(conn: typeof clinician) {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM order_items WHERE id=? AND order_id=? FOR UPDATE",
      [id.item,id.order]);
    return rows;
  }
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org,"RSL"+suffix,"Synthetic result-lock lab"],"DELETE FROM organizations WHERE id=?",[id.org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.branch,id.org,"RSL"+suffix,"Synthetic branch"],"DELETE FROM branches WHERE id=?",[id.branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.user,id.org,"rsl"+suffix,"Synthetic staff"],"DELETE FROM users WHERE id=?",[id.user]);
    await seed("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"RSL"+suffix,"Synthetic Patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?",[id.patient]);
    await seed("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.test,id.org,"RSL"+suffix,"Synthetic test"],"DELETE FROM lab_tests WHERE id=?",[id.test]);
    await seed("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id.order,id.org,"RSL"+suffix,id.branch,id.patient,id.user],
      "DELETE FROM orders WHERE id=?",[id.order]);
    await seed("INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [id.item,id.order,id.test,"RSL"+suffix,"Synthetic test"],
      "DELETE FROM order_items WHERE id=?",[id.item]);
    await clinician.query("SET SESSION innodb_lock_wait_timeout=1");
    await canceller.query("SET SESSION innodb_lock_wait_timeout=1");

    // A previously rendered result editor may still display REGISTERED here.
    await canceller.beginTransaction();
    await canceller.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [id.order]);
    await clinician.beginTransaction();
    await assert.rejects(() => lockOrder(clinician),
      (e:unknown) => Boolean(e && typeof e==="object" && "code" in e &&
        e.code==="ER_LOCK_WAIT_TIMEOUT"),"result writer must serialize with order cancellation");
    await clinician.rollback();
    await canceller.commit();

    await clinician.beginTransaction();
    const currentOrder = await lockOrder(clinician);
    const currentItem = await lockItem(clinician);
    assert.equal(currentOrder[0].status,"CANCELLED");
    assert.equal(currentItem[0].status,"ORDERED");
    assert.equal(["REGISTERED","COLLECTED","IN_PROGRESS"].includes(currentOrder[0].status),false);
    await clinician.rollback();

    // A test cancelled independently of its order cannot be resurrected.
    await db.execute("UPDATE orders SET status='REGISTERED' WHERE id=?", [id.order]);
    await db.execute("UPDATE order_items SET status='CANCELLED' WHERE id=?", [id.item]);
    await clinician.beginTransaction();
    const openOrder = await lockOrder(clinician);
    const closedItem = await lockItem(clinician);
    assert.equal(openOrder[0].status,"REGISTERED");
    assert.equal(closedItem[0].status,"CANCELLED");
    assert.equal(["ORDERED","COLLECTED","IN_PROGRESS","RESULTED"].includes(closedItem[0].status),false);
    await clinician.rollback();

    // When the result writer holds its order lock, another transaction
    // cannot cancel and produce an impossible current order status mid-write.
    await db.execute("UPDATE order_items SET status='ORDERED' WHERE id=?", [id.item]);
    await clinician.beginTransaction();
    assert.equal((await lockOrder(clinician))[0].status,"REGISTERED");
    assert.equal((await lockItem(clinician))[0].status,"ORDERED");
    await canceller.beginTransaction();
    await assert.rejects(
      () => canceller.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [id.order]),
      (e:unknown) => Boolean(e && typeof e==="object" && "code" in e &&
        e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await canceller.rollback();
    await clinician.rollback();
  } finally {
    await clinician.rollback().catch(()=>{});
    await canceller.rollback().catch(()=>{});
    for (const row of undo) await db.execute(row.sql,row.values).catch(()=>{});
    await Promise.all([db.end(),clinician.end(),canceller.end()]);
  }
});
