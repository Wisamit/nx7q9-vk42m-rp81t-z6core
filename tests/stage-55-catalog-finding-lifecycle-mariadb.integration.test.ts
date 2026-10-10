import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { resolveFindingLifecycle, triageResubmission } from "../src/lib/catalog-finding-lifecycle.ts";

test("Stage 55 MariaDB: latest durable flag/decision, committed live drift and fresh re-referral", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [author, expert] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), foreignOrg = randomUUID(), branch = randomUUID(),
    testId = randomUUID(), foreignTest = randomUUID(), authorId = randomUUID(),
    expertId = randomUUID(), batchId = randomUUID(), rowId = randomUUID(),
    flag1 = randomUUID(), flag2 = randomUUID(), decision1 = randomUUID();
  const prefix = "S55" + org.slice(0, 8);
  const secret = "test-only-stage55-observation-secret-no-prod";
  const checksum = "9".repeat(64);
  const source = { id: testId, code: prefix + "T", nameEn: "Original" };
  const oldLive = { ...source };
  const originalToken = catalogDriftObservationToken(secret, checksum, 1, "TEST", source, oldLive);
  const put = (sql: string, vals: Array<string | number | null>) => author.execute(sql, vals);
  try {
    for (const [id, suffix] of [[org, "O"], [foreignOrg, "F"]])
      await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, prefix + suffix, "Stage 55 Tenant"]);
    await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, prefix + "B", "Stage 55 Branch"]);
    for (const [id, tenant, suffix] of [[testId, org, "T"], [foreignTest, foreignOrg, "F"]])
      await put("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, tenant, prefix + suffix, "Original"]);
    for (const [id, suffix] of [[authorId, "A"], [expertId, "E"]])
      await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, prefix + suffix, "Stage 55 Reviewer"]);
    await put("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage55.json',?,'DRAFT',?,NOW(3))",
      [batchId, org, checksum, authorId]);
    await put("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,NOW(3))",
      [rowId, batchId, testId, JSON.stringify(source), JSON.stringify(source)]);
    const flagData = (token: string) => JSON.stringify({
      batchId, rowNumber: 1, entityType: "TEST", category: "CLINICAL",
      reasonCode: "REQUIRES_DOMAIN_ASSESSMENT", evidenceToken: token,
      reviewOnly: true, approved: false, activated: false,
    });
    await put("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?)",
      [flag1, org, branch, authorId, rowId, flagData(originalToken)]);
    await put("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_DECISION_RECORDED','CatalogExpertReviewFlag',?,?)",
      [decision1, org, branch, expertId, flag1, JSON.stringify({
        batchId, rowId, category: "CLINICAL",
        disposition: "RETURN_FOR_CORRECTION", evidenceToken: originalToken,
        reviewOnly: true, approved: false, activated: false,
      })]);

    await expert.beginTransaction();
    const [tenantLock] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    assert.equal(tenantLock.length, 1);
    const [previous] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT a.id,a.new_values FROM audit_events a WHERE a.organization_id=? AND a.entity_type='CatalogImportRow' AND a.entity_id=? AND a.action='CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1",
      [org, rowId]);
    assert.equal(previous.length, 1);
    assert.equal(previous[0].id, flag1);
    const historical = typeof previous[0].new_values === "string" ?
      JSON.parse(previous[0].new_values) : previous[0].new_values;
    const [decisions] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT new_values FROM audit_events WHERE organization_id=? AND action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED' AND entity_id=?",
      [org, flag1]);
    const decided = typeof decisions[0].new_values === "string" ?
      JSON.parse(decisions[0].new_values) : decisions[0].new_values;
    assert.equal(resolveFindingLifecycle({
      evidenceToken: historical.evidenceToken, currentObservation: originalToken,
      decision: decided.disposition,
    }).status, "RETURNED_FOR_CORRECTION");
    assert.equal(triageResubmission({
      evidenceToken: historical.evidenceToken, currentObservation: originalToken,
      decision: decided.disposition,
    }, "FOLLOW_UP_REQUIRED", historical.reasonCode), "DECIDED");
    await expert.commit();

    // New live master data requires new evidence, not reuse of the old decision.
    await put("UPDATE lab_tests SET name_en='Updated after review' WHERE id=?", [testId]);
    const [changed] = await author.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en FROM lab_tests WHERE id=? AND organization_id=?",
      [testId, org]);
    const newLive = { id: String(changed[0].id), code: String(changed[0].code),
      nameEn: String(changed[0].name_en) };
    const newToken = catalogDriftObservationToken(secret, checksum, 1, "TEST", source, newLive);
    assert.equal(resolveFindingLifecycle({
      evidenceToken: originalToken, currentObservation: newToken,
      decision: "RETURN_FOR_CORRECTION",
    }).status, "STALE_REVIEW_REQUIRED");
    assert.equal(triageResubmission({
      evidenceToken: originalToken, currentObservation: newToken,
      decision: "RETURN_FOR_CORRECTION",
    }, "FOLLOW_UP_REQUIRED", "REQUIRES_DOMAIN_ASSESSMENT"), "NEW_EVIDENCE");

    await put("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?,DATE_ADD(NOW(3), INTERVAL 2 SECOND))",
      [flag2, org, branch, authorId, rowId, flagData(newToken)]);
    await expert.beginTransaction();
    const [referral] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id,new_values FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED' ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [org, rowId]);
    assert.equal(referral.length, 1);
    assert.equal(referral[0].id, flag2);
    assert.equal(resolveFindingLifecycle({
      evidenceToken: newToken, currentObservation: newToken, decision: null,
    }).status, "AWAITING_EXPERT");
    const [noNewDecision] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED'",
      [org, flag2]);
    assert.equal(noNewDecision.length, 0);
    const [foreignVisible] = await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?", [foreignTest, org]);
    assert.equal(foreignVisible.length, 0);
    await expert.commit();
    const [unmodified] = await author.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?", [testId]);
    assert.equal(unmodified[0].name_en, "Updated after review");
  } finally {
    await author.rollback().catch(() => {});
    await expert.rollback().catch(() => {});
    await put("DELETE FROM audit_events WHERE id IN (?,?,?)", [flag1, flag2, decision1]).catch(() => {});
    await put("DELETE FROM catalog_import_rows WHERE id=?", [rowId]).catch(() => {});
    await put("DELETE FROM catalog_import_batches WHERE id=?", [batchId]).catch(() => {});
    await put("DELETE FROM lab_tests WHERE id IN (?,?)", [testId, foreignTest]).catch(() => {});
    await put("DELETE FROM users WHERE id IN (?,?)", [authorId, expertId]).catch(() => {});
    await put("DELETE FROM branches WHERE id=?", [branch]).catch(() => {});
    await put("DELETE FROM organizations WHERE id IN (?,?)", [org, foreignOrg]).catch(() => {});
    await Promise.all([author.end(), expert.end()]);
  }
});
