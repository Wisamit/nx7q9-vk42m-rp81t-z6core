import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { expertDispositionAllowed } from "../src/lib/catalog-expert-disposition.ts";

test("Stage 56 MariaDB: preview is read-only and stale/decided flags cannot produce new decisions", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [writer, inspector] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), outsiderOrg = randomUUID(), branch = randomUUID();
  const author = randomUUID(), reviewer = randomUUID(), testId = randomUUID(), outsiderTest = randomUUID();
  const rowId = randomUUID(), batchId = randomUUID(), flagId = randomUUID(), decisionId = randomUUID();
  const prefix = "S56" + org.slice(0, 8);
  const secret = "stage56-mariadb-only-signing-key-not-production";
  const checksum = "b".repeat(64);
  const source = { id: testId, code: prefix + "T", nameEn: "Initial" };
  const oldLive = { ...source };
  const oldToken = catalogDriftObservationToken(secret, checksum, 1, "TEST", source, oldLive);
  const run = (sql: string, args: Array<string | number | null>) => writer.execute(sql, args);
  try {
    for (const [id, suffix] of [[org, "A"], [outsiderOrg, "X"]]) {
      await run("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, prefix + suffix, "Stage 56 Organization"]);
    }
    await run("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, prefix + "B", "Stage 56 Branch"]);
    for (const [id, tenant, suffix] of [[testId, org, "T"], [outsiderTest, outsiderOrg, "F"]]) {
      await run("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, tenant, prefix + suffix, "Initial"]);
    }
    for (const [id, suffix] of [[author, "A"], [reviewer, "R"]]) {
      await run("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, prefix + suffix, "Stage 56 Reviewer"]);
    }
    await run("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage56.json',?,'DRAFT',?,NOW(3))",
      [batchId, org, checksum, author]);
    await run("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,NOW(3))",
      [rowId, batchId, JSON.stringify(source), JSON.stringify(source)]);
    await run("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?)",
      [flagId, org, branch, author, rowId, JSON.stringify({
        batchId, rowNumber: 1, entityType: "TEST", category: "CLINICAL",
        reasonCode: "REQUIRES_DOMAIN_ASSESSMENT", evidenceToken: oldToken,
        reviewOnly: true, approved: false, activated: false,
      })]);

    // Emulate the exact preflight's organization lock and consistent source/live
    // snapshot. A pure inspection cannot append audit decisions.
    await inspector.beginTransaction();
    const [locked] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    assert.equal(locked.length, 1);
    const [flag] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,new_values FROM audit_events WHERE id=? AND organization_id=?",
      [flagId, org]);
    assert.equal(flag.length, 1);
    const [live] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en FROM lab_tests WHERE id=? AND organization_id=?",
      [testId, org]);
    const snapshot = {
      id: String(live[0].id), code: String(live[0].code),
      nameEn: String(live[0].name_en),
    };
    const permissions = new Set(["catalog.manage", "catalog.reference_ranges.manage"]);
    assert.equal(expertDispositionAllowed({
      expertUserId: reviewer, batchAuthorId: author, flagActorUserId: author,
      eventCategory: "CLINICAL", entityType: "TEST",
      flaggedEvidence: oldToken,
      latestEvidence: catalogDriftObservationToken(secret, checksum, 1, "TEST", source, snapshot),
      sessionPermissions: permissions, livePermissions: permissions,
      isLatestFlag: true, isOpenDraft: true,
    }).allowed, true);
    const [notDecided] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED' AND entity_id=?",
      [org, flagId]);
    assert.equal(notDecided.length, 0);
    await inspector.commit();

    await run("UPDATE lab_tests SET name_en='Changed after observation' WHERE id=?", [testId]);
    const [later] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en FROM lab_tests WHERE id=? AND organization_id=?", [testId, org]);
    const updated = {
      id: String(later[0].id), code: String(later[0].code),
      nameEn: String(later[0].name_en),
    };
    const stale = expertDispositionAllowed({
      expertUserId: reviewer, batchAuthorId: author, flagActorUserId: author,
      eventCategory: "CLINICAL", entityType: "TEST",
      flaggedEvidence: oldToken,
      latestEvidence: catalogDriftObservationToken(secret, checksum, 1, "TEST", source, updated),
      sessionPermissions: permissions, livePermissions: permissions,
      isLatestFlag: true, isOpenDraft: true,
    });
    assert.deepEqual(stale, { allowed: false, reason: "expert_evidence_stale" });
    const [foreign] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?", [outsiderTest, org]);
    assert.equal(foreign.length, 0);
    const [countBefore] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED'",
      [org, flagId]);
    assert.equal(Number(countBefore[0].total), 0);

    // A genuine review action may persist one audit-only decision, never
    // change a master. A second contradictory choice must be refused.
    await run("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_DECISION_RECORDED','CatalogExpertReviewFlag',?,?)",
      [decisionId, org, branch, reviewer, flagId, JSON.stringify({
        disposition: "RETURN_FOR_CORRECTION", category: "CLINICAL",
        reviewOnly: true, approved: false, activated: false,
      })]);
    const [one] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT new_values FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED'",
      [org, flagId]);
    assert.equal(one.length, 1);
    const stored = typeof one[0].new_values === "string" ?
      JSON.parse(one[0].new_values) : one[0].new_values;
    assert.equal(stored.disposition, "RETURN_FOR_CORRECTION");
    assert.equal(stored.approved, false);
    assert.equal(stored.activated, false);
    assert.notEqual(stored.disposition, "CONFIRM_FINDING");
    const [testAfter] = await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?", [testId]);
    assert.equal(testAfter[0].name_en, "Changed after observation");
  } finally {
    await writer.rollback().catch(() => {});
    await inspector.rollback().catch(() => {});
    await run("DELETE FROM audit_events WHERE id IN (?,?)", [flagId, decisionId]).catch(() => {});
    await run("DELETE FROM catalog_import_rows WHERE id=?", [rowId]).catch(() => {});
    await run("DELETE FROM catalog_import_batches WHERE id=?", [batchId]).catch(() => {});
    await run("DELETE FROM lab_tests WHERE id IN (?,?)", [testId, outsiderTest]).catch(() => {});
    await run("DELETE FROM users WHERE id IN (?,?)", [author, reviewer]).catch(() => {});
    await run("DELETE FROM branches WHERE id=?", [branch]).catch(() => {});
    await run("DELETE FROM organizations WHERE id IN (?,?)", [org, outsiderOrg]).catch(() => {});
    await Promise.all([writer.end(), inspector.end()]);
  }
});
