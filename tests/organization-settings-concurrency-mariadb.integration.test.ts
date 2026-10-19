import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const api = readFileSync("src/app/api/settings/route.ts", "utf8");
const page = readFileSync("src/components/system-settings-form.tsx", "utf8");
const settings = readFileSync("src/lib/system-settings.ts", "utf8");

test("organization settings revision is required, locked and audit old-values come from the transaction", () => {
  assert.match(api, /Number\.isSafeInteger\(expectedRevision\)/);
  assert.match(api, /SELECT settings_revision FROM organizations[\s\S]*FOR UPDATE/);
  assert.match(api, /locked\[0\]\.settings_revision !== expectedRevision/);
  assert.match(api, /getOrganizationSystemSettings\(session\.user\.organizationId, tx\)/);
  assert.match(api, /settingsRevision: \{ increment: 1 \}/);
  assert.match(api, /settings_revision_conflict/);
  assert.match(api, /status: 409/);
  assert.match(api, /settingsRevision: before\.settingsRevision/);
  assert.match(page, /body\.error === "settings_revision_conflict"/);
  assert.match(page, /Your edits were not applied/);
  assert.match(settings, /settingsRevision: organization\.settingsRevision/);
});

test("MariaDB: two organization-settings editors cannot overwrite each other's saved revision", {timeout: 30000}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const uri = new URL(process.env.DATABASE_URL);
  const connection = {
    host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1),
  };
  const [setup, writer, stale] = await Promise.all([
    mysql.createConnection(connection), mysql.createConnection(connection), mysql.createConnection(connection),
  ]);
  const orgId = randomUUID(), settingId = randomUUID(), code = "REV" + orgId.slice(0, 8);
  let insertedOrg = false, insertedSetting = false;
  try {
    await setup.execute("INSERT INTO organizations (id, code, name_en, updated_at) VALUES (?, ?, ?, NOW(3))",
      [orgId, code, "Synthetic organization"]);
    insertedOrg = true;
    await setup.execute("INSERT INTO organization_settings (id, organization_id, system_name_en, updated_at) VALUES (?, ?, ?, NOW(3))",
      [settingId, orgId, "Original"]);
    insertedSetting = true;
    await stale.query("SET SESSION innodb_lock_wait_timeout = 1");

    await writer.beginTransaction();
    const [first] = await writer.execute<mysql.RowDataPacket[]>(
      "SELECT settings_revision FROM organizations WHERE id=? FOR UPDATE", [orgId]);
    assert.equal(first[0].settings_revision, 0);

    await stale.beginTransaction();
    await assert.rejects(async () => {
      await stale.execute("SELECT settings_revision FROM organizations WHERE id=? FOR UPDATE", [orgId]);
    }, (error: unknown) => Boolean(error && typeof error === "object" &&
      "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await stale.rollback();

    const [claimed] = await writer.execute<mysql.ResultSetHeader>(
      "UPDATE organizations SET settings_revision=settings_revision+1 WHERE id=? AND settings_revision=0",
      [orgId]);
    assert.equal(claimed.affectedRows, 1);
    await writer.execute("UPDATE organization_settings SET system_name_en=? WHERE organization_id=?",
      ["First editor", orgId]);
    await writer.commit();

    await stale.beginTransaction();
    const [fresh] = await stale.execute<mysql.RowDataPacket[]>(
      "SELECT settings_revision FROM organizations WHERE id=? FOR UPDATE", [orgId]);
    assert.equal(fresh[0].settings_revision, 1, "stale editor must observe committed winning revision");
    const staleExpectedRevision = 0;
    assert.notEqual(fresh[0].settings_revision, staleExpectedRevision,
      "outdated form must return conflict before any settings or audit write");
    await stale.rollback();

    const [values] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT o.settings_revision AS revision, s.system_name_en AS systemName FROM organizations o JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?",
      [orgId]);
    assert.equal(values[0].revision, 1);
    assert.equal(values[0].systemName, "First editor");
  } finally {
    await Promise.all([writer.rollback().catch(() => {}), stale.rollback().catch(() => {})]);
    if (insertedSetting) await setup.execute("DELETE FROM organization_settings WHERE id=?", [settingId]);
    if (insertedOrg) await setup.execute("DELETE FROM organizations WHERE id=?", [orgId]);
    await Promise.all([setup.end(), writer.end(), stale.end()]);
  }
});
