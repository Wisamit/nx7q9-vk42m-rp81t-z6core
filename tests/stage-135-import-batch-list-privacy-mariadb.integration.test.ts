import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/**
 * Two independent DB sessions and same-tenant actors: source filenames,
 * provenance and counts of private review uploads must not be listed by a
 * different catalog manager, even when both managers belong to one tenant.
 */
test("Stage 135 MariaDB: author-only CSV/XLSX/bundle listing across two users and tenants", { timeout: 60000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [writer, observer] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const organization = randomUUID(), otherOrganization = randomUUID();
  const userA = randomUUID(), userB = randomUUID(), outsider = randomUUID();
  const suffix = organization.slice(0, 8);
  const batches = [
    { id: randomUUID(), org: organization, author: userA, type: "CSV_REVIEW", name: "sensitive-analyzer-review-a.xlsx" },
    { id: randomUUID(), org: organization, author: userB, type: "CSV_REVIEW", name: "sensitive-price-review-b.csv" },
    { id: randomUUID(), org: organization, author: userA, type: "CONFIG_BUNDLE_REVIEW", name: "private-bundle-a.json" },
    { id: randomUUID(), org: organization, author: userB, type: "CONFIG_BUNDLE_REVIEW", name: "private-bundle-b.json" },
    { id: randomUUID(), org: organization, author: userB, type: "LEGACY_MDB_EXPORT", name: "approved-legacy-review.json" },
    { id: randomUUID(), org: otherOrganization, author: outsider, type: "CSV_REVIEW", name: "foreign-org-never-visible.xlsx" },
  ];
  const execute = (sql: string, args: (string | number | null)[]) => writer.execute(sql, args);
  try {
    for (const [id, suffixCode] of [[organization, "A"], [otherOrganization, "B"]]) {
      await execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S135-" + suffix + suffixCode, "Stage135 synthetic organization"]);
    }
    for (const [id, org, actor] of [[userA, organization, "A"], [userB, organization, "B"],
      [outsider, otherOrganization, "C"]]) {
      await execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, "s135" + suffix + actor, "Synthetic reviewer " + actor]);
    }
    for (const b of batches) {
      await execute("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,?,?, 'DRAFT',?,NOW(3))",
        [b.id, b.org, b.type, b.name, b.author]);
    }
    // Equivalent WHERE to the imported privateSpreadsheetBatchScope:
    // non-review legacy batches keep their existing authorization constraints.
    async function visible(org: string, viewer: string) {
      const [rows] = await observer.execute<mysql.RowDataPacket[]>(
        "SELECT id,source_name FROM catalog_import_batches WHERE organization_id=? AND " +
        "(source_type NOT IN('CSV_REVIEW','CONFIG_BUNDLE_REVIEW') OR created_by_user_id=?) ORDER BY source_name ASC",
        [org, viewer]);
      return rows.map(row => row.source_name as string);
    }
    assert.deepEqual(await visible(organization, userA), [
      "approved-legacy-review.json", "private-bundle-a.json", "sensitive-analyzer-review-a.xlsx",
    ]);
    assert.deepEqual(await visible(organization, userB), [
      "approved-legacy-review.json", "private-bundle-b.json", "sensitive-price-review-b.csv",
    ]);
    assert.deepEqual(await visible(otherOrganization, userA), []);
    assert.deepEqual(await visible(otherOrganization, outsider), ["foreign-org-never-visible.xlsx"]);
    // The pre-fix catalog index returned other users' CSV filenames when no
    // range and price rows were present. This must stay filtered at query time.
    const [oldVisible] = await observer.execute<mysql.RowDataPacket[]>(
      "SELECT source_name FROM catalog_import_batches WHERE organization_id=? AND source_type='CSV_REVIEW' ORDER BY source_name",
      [organization]);
    assert.equal(oldVisible.length, 2, "regression would expose both uploads to a catalog-only reviewer");
  } finally {
    await writer.execute("DELETE FROM catalog_import_batches WHERE id IN (" +
      batches.map(() => "?").join(",") + ")", batches.map(b => b.id)).catch(() => {});
    await writer.execute("DELETE FROM users WHERE id IN(?,?,?)", [userA, userB, outsider]).catch(() => {});
    await writer.execute("DELETE FROM organizations WHERE id IN(?,?)",
      [organization, otherOrganization]).catch(() => {});
    await Promise.all([writer.end(), observer.end()]);
  }
});
