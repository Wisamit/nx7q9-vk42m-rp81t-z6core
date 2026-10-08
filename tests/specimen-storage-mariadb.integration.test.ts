import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB serializes a storage deactivation behind a relocation location lock", { timeout: 30000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for MariaDB integration test");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const setup = await mysql.createConnection(config);
  const relocating = await mysql.createConnection(config);
  const deactivating = await mysql.createConnection(config);
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const locationId = randomUUID();
  const suffix = organizationId.slice(0, 8);
  let insertedOrganization = false;
  let insertedBranch = false;
  let insertedLocation = false;
  try {
    await setup.execute("INSERT INTO organizations (id, code, name_en, updated_at) VALUES (?, ?, ?, NOW(3))",
      [organizationId, "LOC-" + suffix, "Storage Lock Integration"]);
    insertedOrganization = true;
    await setup.execute("INSERT INTO branches (id, organization_id, code, name_en, updated_at) VALUES (?, ?, ?, ?, NOW(3))",
      [branchId, organizationId, "B-" + suffix, "Lock Test Branch"]);
    insertedBranch = true;
    await setup.execute(`INSERT INTO specimen_storage_locations
      (id, organization_id, branch_id, path, zone, unit, rack, slot, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [locationId, organizationId, branchId, "Integration / Fridge / Rack / Slot", "Integration", "Fridge", "Rack", "Slot"]);
    insertedLocation = true;

    await relocating.beginTransaction();
    const [locked] = await relocating.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimen_storage_locations WHERE id = ? AND branch_id = ? AND status = 'ACTIVE' FOR UPDATE",
      [locationId, branchId]);
    assert.equal(locked.length, 1);

    await deactivating.query("SET SESSION innodb_lock_wait_timeout = 1");
    await deactivating.beginTransaction();
    await assert.rejects(
      deactivating.execute("UPDATE specimen_storage_locations SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'", [locationId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT",
    );
    await deactivating.rollback();
    await relocating.commit();

    await deactivating.beginTransaction();
    const [update] = await deactivating.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_storage_locations SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'", [locationId]);
    assert.equal(update.affectedRows, 1);
    await deactivating.commit();

    const [inactive] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM specimen_storage_locations WHERE id = ?", [locationId]);
    assert.equal(inactive[0]?.status, "INACTIVE");
  } finally {
    await relocating.rollback().catch(() => {});
    await deactivating.rollback().catch(() => {});
    if (insertedLocation) await setup.execute("DELETE FROM specimen_storage_locations WHERE id = ?", [locationId]);
    if (insertedBranch) await setup.execute("DELETE FROM branches WHERE id = ?", [branchId]);
    if (insertedOrganization) await setup.execute("DELETE FROM organizations WHERE id = ?", [organizationId]);
    await Promise.all([setup.end(), relocating.end(), deactivating.end()]);
  }
});
