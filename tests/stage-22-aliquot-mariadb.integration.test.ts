import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: aliquot locks reject concurrent order closure, test rejection and container deactivation without consuming volume", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const uri = new URL(process.env.DATABASE_URL);
  const config = {
    host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1),
  };
  const [writer, operator] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const inserted: Array<{ table: string; id: string }> = [];
  const tenant = randomUUID(), foreignTenant = randomUUID(), branch = randomUUID(), foreignBranch = randomUUID();
  const actor = randomUUID(), foreignActor = randomUUID();
  const patient = randomUUID(), foreignPatient = randomUUID();
  const testId = randomUUID(), order = randomUUID(), item = randomUUID(), specimen = randomUUID();
  const container = randomUUID(), foreignContainer = randomUUID();
  const suffix = tenant.slice(0, 8);

  async function insert(sql: string, args: unknown[], table: string, id: string) {
    await writer.execute(sql, args);
    inserted.unshift({ table, id });
  }
  async function lockOrder() {
    const [rows] = await operator.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE id = ? AND organization_id = ? AND status NOT IN ('CANCELLED','COMPLETED') FOR UPDATE",
      [order, tenant],
    );
    return rows.length === 1;
  }
  async function lockLinkedTest() {
    const [rows] = await operator.execute<mysql.RowDataPacket[]>(
      `SELECT soi.order_item_id AS orderItemId FROM specimen_order_items soi
       JOIN order_items oi ON oi.id = soi.order_item_id
       WHERE soi.specimen_id = ? AND soi.status = 'ACTIVE'
         AND oi.status <> 'CANCELLED' AND oi.order_id = ?
         AND soi.order_item_id IN (?) FOR UPDATE`, [specimen, order, item],
    );
    return rows.length === 1;
  }
  async function lockContainer(id: string, org: string) {
    const [rows] = await operator.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM containers WHERE id = ? AND organization_id = ? AND status = 'ACTIVE' FOR UPDATE",
      [id, org],
    );
    return rows.length === 1;
  }
  async function remaining() {
    const [rows] = await operator.execute<mysql.RowDataPacket[]>(
      "SELECT remaining_volume AS volume FROM specimens WHERE id = ?", [specimen],
    );
    return String(rows[0].volume);
  }

  try {
    for (const [id, code] of [[tenant,"T"],[foreignTenant,"F"]])
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"A22-"+code+suffix,"Stage 22 Tenant"],"organizations",id);
    for (const [id,org,code] of [[branch,tenant,"T"],[foreignBranch,foreignTenant,"F"]])
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"A22-"+code+suffix,"Stage 22 Branch"],"branches",id);
    for (const [id,org,code] of [[actor,tenant,"T"],[foreignActor,foreignTenant,"F"]])
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"a22-"+code+suffix,"Stage 22 Operator"],"users",id);
    for (const [id,org,code] of [[patient,tenant,"T"],[foreignPatient,foreignTenant,"F"]])
      await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,org,"A22-"+code+suffix,"Stage 22 Patient","stage 22 patient"],"patients",id);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,tenant,"A22-T"+suffix,"Stage 22 Test"],"lab_tests",testId);
    for (const [id,org,code] of [[container,tenant,"T"],[foreignContainer,foreignTenant,"F"]])
      await insert("INSERT INTO containers (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"A22-"+code+suffix,"Stage 22 Container"],"containers",id);
    await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,tenant,"A22-"+suffix,branch,patient,actor],"orders",order);
    await insert("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [item,order,testId,"A22","Stage 22 Test"],"order_items",item);
    await insert("INSERT INTO specimens (id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,volume,volume_unit,remaining_volume,remaining_volume_unit,updated_at) VALUES (?,?,?,?,?,'RECEIVED',?,2.000,'mL',2.000,'mL',NOW(3))",
      [specimen,tenant,order,"A22-"+suffix+"-01",1,branch],"specimens",specimen);
    await writer.execute("INSERT INTO specimen_order_items (specimen_id,order_item_id,status) VALUES (?,?,'ACTIVE')",
      [specimen,item]);

    // A concurrent order closure already committed by another session must be rejected.
    await writer.execute("UPDATE orders SET status='CANCELLED' WHERE id=?", [order]);
    await operator.beginTransaction();
    assert.equal(await lockOrder(), false);
    await operator.rollback();
    assert.equal(await remaining(), "2.000");

    await writer.execute("UPDATE orders SET status='REGISTERED' WHERE id=?", [order]);
    await writer.execute("UPDATE specimen_order_items SET status='REJECTED' WHERE specimen_id=? AND order_item_id=?",[specimen,item]);
    await operator.beginTransaction();
    assert.equal(await lockOrder(), true);
    assert.equal(await lockLinkedTest(), false);
    await operator.rollback();
    assert.equal(await remaining(), "2.000");

    await writer.execute("UPDATE specimen_order_items SET status='ACTIVE' WHERE specimen_id=? AND order_item_id=?",[specimen,item]);
    await writer.execute("UPDATE containers SET status='INACTIVE' WHERE id=?", [container]);
    await operator.beginTransaction();
    assert.equal(await lockOrder(), true);
    assert.equal(await lockLinkedTest(), true);
    assert.equal(await lockContainer(container,tenant), false);
    await operator.rollback();
    assert.equal(await remaining(), "2.000");
    assert.equal(await lockContainer(foreignContainer,tenant), false);

    // Hold the test association lock on a separate database connection.
    // The aliquot session may not see the link as safe while it is changing.
    await writer.execute("UPDATE containers SET status='ACTIVE' WHERE id=?", [container]);
    await writer.query("SET SESSION innodb_lock_wait_timeout = 1");
    await operator.query("SET SESSION innodb_lock_wait_timeout = 1");
    await writer.beginTransaction();
    await writer.execute("UPDATE specimen_order_items SET status='REJECTED' WHERE specimen_id=? AND order_item_id=?",[specimen,item]);
    await operator.beginTransaction();
    await assert.rejects(lockLinkedTest(), (error: unknown) =>
      error !== null && typeof error === "object" && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT");
    await operator.rollback();
    await writer.rollback();
    await operator.beginTransaction();
    assert.equal(await lockOrder(), true);
    assert.equal(await lockLinkedTest(), true);
    assert.equal(await lockContainer(container,tenant), true);
    const [update] = await operator.execute<mysql.ResultSetHeader>(
      `UPDATE specimens SET remaining_volume=remaining_volume-0.500,preanalytical_version=preanalytical_version+1
       WHERE id=? AND organization_id=? AND current_branch_id=?
         AND status='RECEIVED' AND remaining_volume >= 0.500 AND preanalytical_version=0
         AND EXISTS (SELECT 1 FROM orders WHERE id=? AND organization_id=? AND status NOT IN ('CANCELLED','COMPLETED'))
         AND EXISTS (SELECT 1 FROM specimen_order_items WHERE specimen_id=? AND order_item_id=? AND status='ACTIVE')`,
      [specimen,tenant,branch,order,tenant,specimen,item],
    );
    assert.equal(update.affectedRows, 1);
    await operator.rollback();
    assert.equal(await remaining(), "2.000");
  } finally {
    await operator.rollback().catch(()=>{});
    await writer.rollback().catch(()=>{});
    await writer.execute("DELETE FROM specimen_order_items WHERE specimen_id=? AND order_item_id=?", [specimen,item]).catch(()=>{});
    for (const row of inserted) await writer.execute(`DELETE FROM ${row.table} WHERE id = ?`,[row.id]);
    await Promise.all([writer.end(),operator.end()]);
  }
});
