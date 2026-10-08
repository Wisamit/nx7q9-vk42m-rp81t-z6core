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
  const userId = randomUUID();
  const patientId = randomUUID();
  const orderId = randomUUID();
  const specimenId = randomUUID();
  const suffix = organizationId.slice(0, 8);
  let insertedOrganization = false;
  let insertedBranch = false;
  let insertedLocation = false;
  let insertedSpecimen = false;
  let insertedOrder = false;
  let insertedPatient = false;
  let insertedUser = false;
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
    await setup.execute("INSERT INTO users (id, organization_id, username, display_name_en, updated_at) VALUES (?, ?, ?, ?, NOW(3))",
      [userId, organizationId, "lock-" + suffix, "Storage Integration Actor"]);
    insertedUser = true;
    await setup.execute("INSERT INTO patients (id, organization_id, patient_number, full_name_en, normalized_name, updated_at) VALUES (?, ?, ?, ?, ?, NOW(3))",
      [patientId, organizationId, "P-" + suffix, "Storage Test Patient", "storage test patient"]);
    insertedPatient = true;
    await setup.execute("INSERT INTO orders (id, organization_id, accession_number, ordering_branch_id, patient_id, created_by_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(3))",
      [orderId, organizationId, "A-" + suffix, branchId, patientId, userId]);
    insertedOrder = true;
    await setup.execute(`INSERT INTO specimens
      (id, organization_id, order_id, barcode, sequence_number, status, current_branch_id, storage_location, storage_location_id, updated_at)
      VALUES (?, ?, ?, ?, 1, 'RECEIVED', ?, ?, ?, NOW(3))`,
      [specimenId, organizationId, orderId, "LOCK-" + suffix, branchId, "Integration / Fridge / Rack / Slot", locationId]);
    insertedSpecimen = true;

    // An occupied registered position must be denied deactivation.
    const [occupied] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS occupied FROM specimens WHERE current_branch_id = ? AND storage_location_id = ? AND status <> 'DISPOSED'",
      [branchId, locationId]);
    assert.equal(Number(occupied[0]?.occupied), 1);

    // Exercise the deactivation transaction's occupied-position rejection with a real FK.
    await deactivating.beginTransaction();
    const [tentativeDisable] = await deactivating.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_storage_locations SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'", [locationId]);
    assert.equal(tentativeDisable.affectedRows, 1);
    const [liveOccupants] = await deactivating.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS occupied FROM specimens
       WHERE organization_id = ? AND current_branch_id = ?
       AND (storage_location_id = ? OR (storage_location_id IS NULL AND storage_location = ?))
       AND status <> 'DISPOSED'`,
      [organizationId, branchId, locationId, "Integration / Fridge / Rack / Slot"]);
    assert.equal(Number(liveOccupants[0]?.occupied), 1);
    await deactivating.rollback();
    const [afterRejectedDisable] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM specimen_storage_locations WHERE id = ?", [locationId]);
    assert.equal(afterRejectedDisable[0]?.status, "ACTIVE");

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

    // Remove the sample's current physical assignment before disabling.
    await setup.execute("UPDATE specimens SET storage_location_id = NULL, storage_location = NULL WHERE id = ?", [specimenId]);
    const [cleared] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS occupied FROM specimens WHERE current_branch_id = ? AND storage_location_id = ? AND status <> 'DISPOSED'",
      [branchId, locationId]);
    assert.equal(Number(cleared[0]?.occupied), 0);

    await deactivating.beginTransaction();
    const [update] = await deactivating.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_storage_locations SET status = 'INACTIVE' WHERE id = ? AND status = 'ACTIVE'", [locationId]);
    assert.equal(update.affectedRows, 1);
    await deactivating.commit();

    const [inactive] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM specimen_storage_locations WHERE id = ?", [locationId]);
    assert.equal(inactive[0]?.status, "INACTIVE");

    // Inverse ordering: a pending relocation cannot lock an inactive location.
    await deactivating.beginTransaction();
    const [reactivated] = await deactivating.execute<mysql.ResultSetHeader>(
      "UPDATE specimen_storage_locations SET status = 'ACTIVE' WHERE id = ?", [locationId]);
    assert.equal(reactivated.affectedRows, 1);
    await relocating.query("SET SESSION innodb_lock_wait_timeout = 1");
    await relocating.beginTransaction();
    await assert.rejects(
      relocating.execute("SELECT id FROM specimen_storage_locations WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [locationId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT",
    );
    await relocating.rollback();
    await deactivating.rollback();

    const [stillInactive] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM specimen_storage_locations WHERE id = ?", [locationId]);
    assert.equal(stillInactive[0]?.status, "INACTIVE");
    await relocating.beginTransaction();
    const [notAssigned] = await relocating.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimen_storage_locations WHERE id = ? AND status = 'ACTIVE' FOR UPDATE", [locationId]);
    assert.equal(notAssigned.length, 0);
    await relocating.commit();
  } finally {
    await relocating.rollback().catch(() => {});
    await deactivating.rollback().catch(() => {});
    if (insertedSpecimen) await setup.execute("DELETE FROM specimens WHERE id = ?", [specimenId]);
    if (insertedOrder) await setup.execute("DELETE FROM orders WHERE id = ?", [orderId]);
    if (insertedPatient) await setup.execute("DELETE FROM patients WHERE id = ?", [patientId]);
    if (insertedUser) await setup.execute("DELETE FROM users WHERE id = ?", [userId]);
    if (insertedLocation) await setup.execute("DELETE FROM specimen_storage_locations WHERE id = ?", [locationId]);
    if (insertedBranch) await setup.execute("DELETE FROM branches WHERE id = ?", [branchId]);
    if (insertedOrganization) await setup.execute("DELETE FROM organizations WHERE id = ?", [organizationId]);
    await Promise.all([setup.end(), relocating.end(), deactivating.end()]);
  }
});
