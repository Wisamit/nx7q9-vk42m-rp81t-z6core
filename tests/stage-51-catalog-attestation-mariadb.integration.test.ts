import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { attestCatalogBundle, verifyCatalogBundleAttestation } from "../src/lib/catalog-bundle-attestation.ts";
import { BUNDLE_REVIEW_SOURCE, parseCatalogBundleForReview } from "../src/lib/catalog-bundle-review.ts";

test("Stage 51 MariaDB two independent sessions: signed content and current branch grants both gate source staging",
{ timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const config = { host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) };
  const [first, second] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const org = randomUUID(), foreignOrg = randomUUID(), branch = randomUUID(),
    department = randomUUID(), testId = randomUUID(), otherTest = randomUUID(),
    actor = randomUUID(), batch = randomUUID(), row = randomUUID();
  const prefix = "S51" + org.slice(0, 8), key = "stage-51-MariaDB-only-secret-at-least-32-bytes";
  const run = (sql: string, args: Array<string | number | null>) => first.execute(sql, args);
  const source = { format: "family-lab-catalog-bundle", schemaVersion: 1,
    organizationId: org, exportedAt: "2026-10-10T00:00:00.000Z",
    consistency: "transactional-consistent-read",
    groups: [{ entityType: "TEST", records: [{
      id: testId, code: prefix + "T", nameEn: "Signed test", departmentId: department, status: "ACTIVE",
    }] }],
  };
  const signed = attestCatalogBundle(source, key);
  try {
    for (const [id, suffix] of [[org, "A"], [foreignOrg, "F"]])
      await run("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, prefix + suffix, "Stage 51 Organization"]);
    await run("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, prefix + "B", "Stage 51 Branch"]);
    await run("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [department, org, branch, prefix + "D", "Stage 51 Department"]);
    for (const [id, tenant, dept, code] of [
      [testId, org, department, prefix + "T"], [otherTest, foreignOrg, null, prefix + "F"],
    ]) await run("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id, tenant, dept, code, "Signed test"]);
    await run("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor, org, prefix, "Stage 51 Reviewer"]);
    await run("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)", [actor, branch]);
    await run("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)", [actor, department]);

    assert.equal(verifyCatalogBundleAttestation(signed, key), "VERIFIED");
    const parsed = parseCatalogBundleForReview(signed, org, { pricing: false, ranges: false });
    assert.equal(parsed.rows[0].identity, testId);
    const altered = { ...signed, groups: [{ entityType: "TEST", records: [{
      ...source.groups[0].records[0], nameEn: "Tampered result label",
    }] }] };
    assert.throws(() => verifyCatalogBundleAttestation(altered, key));
    const crossTenant = { ...signed, organizationId: foreignOrg };
    assert.throws(() => verifyCatalogBundleAttestation(crossTenant, key));

    // The first transaction holds the tenant lock while deleting grants.
    // The queued second transaction must use *current* grants after the lock.
    await first.beginTransaction();
    const [originalLock] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    assert.equal(originalLock.length, 1);
    await second.execute("SET SESSION innodb_lock_wait_timeout=8");
    await second.beginTransaction();
    const queued = second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    await first.execute("DELETE FROM user_department_scopes WHERE user_id=?", [actor]);
    await first.execute("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]);
    await first.commit();
    const [acquired] = await queued;
    assert.equal(acquired.length, 1);
    const [branchGrants] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM user_branch_scopes WHERE user_id=?", [actor]);
    const [departmentGrants] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT department_id FROM user_department_scopes WHERE user_id=?", [actor]);
    assert.equal(branchGrants.length, 0);
    assert.equal(departmentGrants.length, 0);
    const [forbidden] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?", [otherTest, org]);
    assert.equal(forbidden.length, 0);
    await second.commit();
    const [unstaged] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE organization_id=? AND source_type=?",
      [org, BUNDLE_REVIEW_SOURCE]);
    assert.equal(unstaged.length, 0);

    // Only after the granted scope is restored may the signed source be staged.
    await run("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)", [actor, branch]);
    await run("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)", [actor, department]);
    await second.beginTransaction();
    const [relock] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE", [org]);
    assert.equal(relock.length, 1);
    const [permitted] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN user_department_scopes d ON d.department_id=t.department_id JOIN user_branch_scopes b ON b.branch_id=? WHERE t.id=? AND t.organization_id=? AND d.user_id=? AND b.user_id=?",
      [branch, testId, org, actor, actor]);
    assert.deepEqual(permitted.map(x => String(x.id)), [testId]);
    assert.equal(verifyCatalogBundleAttestation(signed, key), "VERIFIED");
    await second.execute(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,summary,updated_at) VALUES(?,?,?,'stage51.json','DRAFT',?,?,NOW(3))",
      [batch, org, BUNDLE_REVIEW_SOURCE, actor, JSON.stringify({ reviewOnly: true, attestationStatus: "VERIFIED" })]);
    await second.execute(
      "INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [row, batch, testId, JSON.stringify(parsed.rows[0].original),
        JSON.stringify(parsed.rows[0].normalized), JSON.stringify([{ severity: "WARNING", code: "CONFIGURATION_BUNDLE_REVIEW_ONLY" }])]);
    await second.commit();
    const [saved] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT status, imported_entity_id FROM catalog_import_rows WHERE id=?", [row]);
    assert.equal(saved[0].status, "WARNING");
    assert.equal(saved[0].imported_entity_id, null);
    const [unchanged] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT name_en,code FROM lab_tests WHERE id=?", [testId]);
    assert.equal(unchanged[0].name_en, "Signed test");
    assert.equal(unchanged[0].code, prefix + "T");
  } finally {
    await first.rollback().catch(() => {});
    await second.rollback().catch(() => {});
    await run("DELETE FROM catalog_import_rows WHERE id=?", [row]).catch(() => {});
    await run("DELETE FROM catalog_import_batches WHERE id=?", [batch]).catch(() => {});
    await run("DELETE FROM user_department_scopes WHERE user_id=?", [actor]).catch(() => {});
    await run("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]).catch(() => {});
    await run("DELETE FROM lab_tests WHERE id IN (?,?)", [testId, otherTest]).catch(() => {});
    await run("DELETE FROM departments WHERE id=?", [department]).catch(() => {});
    await run("DELETE FROM users WHERE id=?", [actor]).catch(() => {});
    await run("DELETE FROM branches WHERE id=?", [branch]).catch(() => {});
    await run("DELETE FROM organizations WHERE id IN (?,?)", [org, foreignOrg]).catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
});
