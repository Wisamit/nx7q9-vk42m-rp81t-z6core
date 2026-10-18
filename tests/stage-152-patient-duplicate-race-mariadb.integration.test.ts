import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { patientDuplicateEvidence } from "../src/lib/patient-duplicate-review.ts";
import { patientCandidateReviewIsCurrent } from "../src/lib/patient-registration-review-guard.ts";

test("Stage 152 MariaDB: independent writers serialize on tenant before checking duplicate identity", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [first, second] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), otherOrg = randomUUID();
  const tag = org.slice(0,8), firstId = randomUUID();
  const dob = "1991-03-17", name = "STAGE152 DUPLICATE PATIENT";
  const find = async (client: typeof first, tenant: string) => {
    const [rows] = await client.execute<mysql.RowDataPacket[]>(
      "SELECT id,normalized_name,date_of_birth,normalized_phone FROM patients " +
      "WHERE organization_id=? AND status='ACTIVE' AND merged_into_patient_id IS NULL " +
      "AND ((normalized_name=? AND date_of_birth=?) OR normalized_phone=?)",
      [tenant, name, dob, "+971500000001"]);
    return rows;
  };
  const lock = async (client: typeof first, tenant: string) => {
    const [rows] = await client.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [tenant]);
    return rows;
  };
  try {
    for (const [id, suffix] of [[org, "A"], [otherOrg, "B"]]) {
      await first.execute(
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S152-" + tag + suffix, "Synthetic patient review laboratory"]);
    }
    await first.beginTransaction();
    assert.equal((await lock(first, org)).length,1);
    // First organization writer sees no matching identity and creates patient
    // while holding the lock until transaction commit.
    assert.equal((await find(first, org)).length, 0);
    await first.execute(
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name," +
      "date_of_birth,normalized_phone,sex_at_birth,updated_at)" +
      " VALUES(?,?,?,?,?,? ,?,'MALE',NOW(3))",
      [firstId, org, "S152-" + tag + "-A", "Stage152 Duplicate Patient", name,
        dob, "+971500000001"]);
    // Another tenant does NOT share this organization's lock.
    await second.beginTransaction();
    assert.equal((await lock(second, otherOrg)).length,1);
    await second.commit();
    // Same tenant cannot begin its own duplicate review while first writer
    // has not committed. This explicitly verifies the MariaDB lock boundary.
    await second.query("SET SESSION innodb_lock_wait_timeout=1");
    await second.beginTransaction();
    await assert.rejects(() => lock(second, org),
      (error: unknown) => Boolean(error && typeof error === "object" &&
        "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();

    // A second operation can now acquire that same organization lock and
    // its first consistent read sees the new patient, requiring human review.
    await second.beginTransaction();
    assert.equal((await lock(second, org)).length,1);
    const found = await find(second, org);
    assert.equal(found.length,1);
    assert.equal(found[0].id,firstId);
    const evidence = patientDuplicateEvidence({
      normalizedName:name, dateOfBirth:new Date(dob+"T00:00:00.000Z"),
      normalizedPhone:"+971500000001",
    },{
      normalizedName:found[0].normalized_name,
      dateOfBirth:new Date(found[0].date_of_birth),
      normalizedPhone:found[0].normalized_phone,
    });
    assert.deepEqual(evidence,["NAME_DOB","PHONE"]);
    assert.equal(patientCandidateReviewIsCurrent([],found.map(row=>row.id)),false);
    assert.equal(patientCandidateReviewIsCurrent([firstId],found.map(row=>row.id)),true);
    assert.equal(patientCandidateReviewIsCurrent([randomUUID()],found.map(row=>row.id)),false);
    await second.rollback();
  } finally {
    await first.rollback().catch(() => {});
    await second.rollback().catch(() => {});
    await first.execute("DELETE FROM patients WHERE id=?", [firstId]).catch(() => {});
    await first.execute("DELETE FROM organizations WHERE id IN (?,?)",
      [org,otherOrg]).catch(() => {});
    await Promise.all([first.end(),second.end()]);
  }
});
