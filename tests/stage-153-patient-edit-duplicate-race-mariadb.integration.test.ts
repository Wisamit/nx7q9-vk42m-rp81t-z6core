import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  patientCandidateReviewIsCurrent,
} from "../src/lib/patient-registration-review-guard.ts";

test("Stage 153 MariaDB: changing a patient's identity and registering another patient serialize by tenant", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [editor, registrar] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), otherOrg = randomUUID(), patientId = randomUUID(), peerId = randomUUID();
  const tag = org.slice(0, 8), previousName = "STAGE153 ORIGINAL", revisedName = "STAGE153 REVIEW";
  const dob = "1992-08-12";
  const lock = async (client: typeof editor, id: string) => {
    const [rows] = await client.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [id]);
    return rows;
  };
  const candidates = async (client: typeof editor) => {
    const [rows] = await client.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM patients WHERE organization_id=? AND id<>? " +
        "AND status='ACTIVE' AND merged_into_patient_id IS NULL " +
        "AND normalized_name=? AND date_of_birth=?",
      [org, patientId, revisedName, dob]);
    return rows.map(row => String(row.id));
  };
  try {
    for (const [id, suffix] of [[org, "A"], [otherOrg, "B"]]) {
      await editor.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S153-" + tag + suffix, "Synthetic patient edit race org"]);
    }
    for (const [id, num, name] of [[patientId, "A", previousName], [peerId, "B", "UNRELATED"]]) {
      await editor.execute(
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name," +
          "date_of_birth,sex_at_birth,updated_at) VALUES(?,?,?,?,?,?,'MALE',NOW(3))",
        [id, org, "S153-" + tag + "-" + num, name, name, dob]);
    }

    // A registrar is holding the tenant serialization lock and writes an
    // otherwise unseen clinical identity before the edit can check matches.
    await registrar.beginTransaction();
    assert.equal((await lock(registrar, org)).length, 1);
    assert.equal((await lock(editor, otherOrg)).length, 1,
      "a different organization is never blocked by this tenant's lock");
    await editor.query("SET SESSION innodb_lock_wait_timeout=1");
    await editor.beginTransaction();
    await assert.rejects(() => lock(editor, org),
      (error: unknown) => Boolean(error && typeof error === "object" &&
        "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await editor.rollback();
    await registrar.execute(
      "UPDATE patients SET full_name_en=?,normalized_name=?,updated_at=NOW(3) WHERE id=?",
      [revisedName, revisedName, peerId]);
    await registrar.commit();

    await editor.beginTransaction();
    assert.equal((await lock(editor, org)).length, 1);
    const found = await candidates(editor);
    assert.deepEqual(found, [peerId],
      "the edit MUST detect newly changed patient identity before any update");
    assert.equal(patientCandidateReviewIsCurrent([], found), false);
    assert.equal(patientCandidateReviewIsCurrent([randomUUID()], found), false);
    assert.equal(patientCandidateReviewIsCurrent([peerId], found), true);
    // Deliberate, reviewed distinction may proceed in the SAME transaction,
    // subject to the unrelated optimistic version check and audit.
    await editor.rollback();

    // Reverse direction: an editor holds the same tenant lock while writing
    // a revised identity; a separate registration cannot inspect an
    // out-of-date patient population and race the edit.
    await editor.beginTransaction();
    assert.equal((await lock(editor, org)).length, 1);
    await editor.execute(
      "UPDATE patients SET full_name_en=?,normalized_name=?,updated_at=NOW(3) WHERE id=?",
      [revisedName, revisedName, patientId]);
    await registrar.query("SET SESSION innodb_lock_wait_timeout=1");
    await registrar.beginTransaction();
    await assert.rejects(() => lock(registrar, org),
      (error: unknown) => Boolean(error && typeof error === "object" &&
        "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await registrar.rollback();
    await editor.commit();

    await registrar.beginTransaction();
    assert.equal((await lock(registrar, org)).length, 1);
    const [all] = await registrar.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM patients WHERE organization_id=? AND status='ACTIVE' " +
        "AND normalized_name=? AND date_of_birth=?",
      [org, revisedName, dob]);
    assert.equal(all.length, 2, "a fresh registration sees the edited identity");
    await registrar.rollback();
  } finally {
    await editor.rollback().catch(() => {});
    await registrar.rollback().catch(() => {});
    await editor.execute("DELETE FROM patients WHERE id IN (?,?)", [patientId, peerId]).catch(() => {});
    await editor.execute("DELETE FROM organizations WHERE id IN (?,?)", [org, otherOrg]).catch(() => {});
    await Promise.all([editor.end(), registrar.end()]);
  }
});
