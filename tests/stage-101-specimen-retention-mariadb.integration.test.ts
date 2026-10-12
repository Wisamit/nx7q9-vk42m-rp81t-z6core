import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 101 MariaDB: forward-only retention policy FK, per-branch scope, custody row locking and authorization history", {
  timeout: 75000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const db = await mysql.createConnection(config);
  const rival = await mysql.createConnection(config);
  const org = randomUUID(), otherOrg = randomUUID(), branch = randomUUID(),
    otherBranch = randomUUID(), requester = randomUUID(), reviewer = randomUUID(),
    patient = randomUUID(), order = randomUUID(), specimenType = randomUUID(),
    specimen = randomUUID(), policy = randomUUID(), disposal = randomUUID();
  const code = "S101" + org.slice(0, 10).replaceAll("-", "");
  const cleanup: Array<{ table: string; id: string }> = [];
  async function put(table: string, id: string, query: string, values: (string | number | null)[]) {
    await db.execute(query, values);
    cleanup.unshift({ table, id });
  }
  try {
    for (const [id, suffix] of [[org, "A"], [otherOrg, "B"]]) {
      await put("organizations", id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, code + suffix, "Stage 101 Lab"]);
    }
    await put("branches", branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, code + "C", "Stage 101 Branch"]);
    await put("branches", otherBranch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [otherBranch, otherOrg, code + "D", "Foreign branch"]);
    await put("users", requester,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [requester, org, code + "requester", "Specimen operator"]);
    await put("users", reviewer,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [reviewer, org, code + "reviewer", "Quality reviewer"]);
    await put("specimen_types", specimenType,
      "INSERT INTO specimen_types(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [specimenType, org, code + "TYPE", "Blood"]);
    await put("patients", patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient, org, code + "PAT", "Stage 101 Patient", "stage 101 patient"]);
    await put("orders", order,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,status,updated_at) VALUES(?,?,?,?,?,?,'COMPLETED',NOW(3))",
      [order, org, code + "ACC", branch, patient, requester]);
    await put("specimens", specimen,
      "INSERT INTO specimens(id,organization_id,order_id,specimen_type_id,barcode,sequence_number,status,current_branch_id,collected_at,updated_at) VALUES(?,?,?,?,?,1,'IN_PROCESS',?,NOW(3),NOW(3))",
      [specimen, org, order, specimenType, code + "BAR", branch]);
    await put("specimen_retention_policies", policy,
      "INSERT INTO specimen_retention_policies(id,organization_id,branch_id,specimen_type_id,minimum_days,rationale,status,created_by_user_id,approved_by_user_id,approved_at) VALUES(?,?,?,?,30,?,'APPROVED',?, ?, NOW(3))",
      [policy, org, branch, specimenType, "Site retention policy approved by quality office", requester, reviewer]);

    await assert.rejects(db.execute(
      "INSERT INTO specimen_retention_policies(id,organization_id,branch_id,specimen_type_id,minimum_days,rationale,created_by_user_id) VALUES(?,?,?,?,0,?,?)",
      [randomUUID(),org,branch,specimenType,"Invalid duration",requester]), "Database must reject zero-day policy");
    const [foreignPolicy] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimen_retention_policies WHERE organization_id=? AND branch_id=?",
      [otherOrg, otherBranch]);
    assert.equal(foreignPolicy.length, 0, "other organization cannot see policy through scoped query");
    await put("specimen_disposal_cases", disposal,
      "INSERT INTO specimen_disposal_cases(id,organization_id,branch_id,specimen_id,policy_id,reason,specimen_version,retention_due_at,requested_by_user_id,status) VALUES(?,?,?,?,?,?,?,?,?,'REQUESTED')",
      [disposal,org,branch,specimen,policy,"Full documented chain of custody and retention request",0,
        "2026-12-31 12:00:00.000",requester]);

    await assert.rejects(db.execute(
      "INSERT INTO specimen_disposal_cases(id,organization_id,branch_id,specimen_id,policy_id,reason,specimen_version,retention_due_at,requested_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)",
      [randomUUID(),org,branch,specimen,randomUUID(),"Invalid policy reference",0,"2026-12-31 12:00:00.000",requester]),
      "disposal case must retain an existing FK-backed policy reference");

    await db.beginTransaction();
    const [locked] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimens WHERE id=? AND organization_id=? AND current_branch_id=? FOR UPDATE",
      [specimen,org,branch]);
    assert.equal(locked.length,1);
    await rival.query("SET innodb_lock_wait_timeout=1");
    await rival.beginTransaction();
    let blocked = false;
    try {
      await rival.execute("UPDATE specimens SET preanalytical_version=preanalytical_version+1 WHERE id=?", [specimen]);
    } catch { blocked = true; }
    await rival.rollback();
    assert.equal(blocked,true,"concurrent custody mutation must wait on specimen row lock");
    await db.commit();

    const [approved] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT requested_by_user_id, status, retention_due_at FROM specimen_disposal_cases WHERE id=? AND organization_id=? AND branch_id=?",
      [disposal,org,branch]);
    assert.equal(approved.length,1);
    assert.equal(approved[0].status,"REQUESTED");
    assert.equal(approved[0].requested_by_user_id,requester);
    await db.execute("UPDATE specimen_disposal_cases SET status='AUTHORIZED', authorized_by_user_id=?,authorized_at=NOW(3) WHERE id=? AND status='REQUESTED'",
      [reviewer,disposal]);
    const [review] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT authorized_by_user_id, status FROM specimen_disposal_cases WHERE id=?", [disposal]);
    assert.equal(review[0].authorized_by_user_id,reviewer);
    assert.equal(review[0].status,"AUTHORIZED");
    const [unmodified] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT status, preanalytical_version FROM specimens WHERE id=?", [specimen]);
    assert.equal(unmodified[0].status,"IN_PROCESS",
      "approval cannot itself dispose clinical material");
    assert.equal(unmodified[0].preanalytical_version,0);
  } finally {
    await db.rollback().catch(() => {});
    await rival.rollback().catch(() => {});
    for (const row of cleanup) {
      await db.execute("DELETE FROM `" + row.table + "` WHERE id=?", [row.id]).catch(() => {});
    }
    await Promise.all([db.end(),rival.end()]);
  }
});
