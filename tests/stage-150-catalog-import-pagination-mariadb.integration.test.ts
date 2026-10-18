import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogImportPageBounds } from "../src/lib/catalog-import-pagination.ts";

/**
 * Real two-session MariaDB pagination: author-private CSV/bundle metadata is
 * excluded by SQL before LIMIT/OFFSET, even across inserts and snapshot reads.
 */
test("Stage 150 MariaDB: scoped import counts/pages are complete and snapshot consistent", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), foreignOrg = randomUUID();
  const actor = randomUUID(), peer = randomUUID(), foreign = randomUUID();
  const suffix = org.slice(0, 8);
  const inserted: string[] = [];
  async function insert(organization: string, author: string, kind: string, number: number) {
    const id = randomUUID();
    await writer.execute(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'DRAFT',?,DATE_ADD('2026-10-01 00:00:00',INTERVAL ? MINUTE),NOW(3))",
      [id, organization, kind, "synthetic-" + number + ".json", author, number]);
    inserted.push(id);
    return id;
  }
  const where = "organization_id=? AND (source_type NOT IN ('CSV_REVIEW','CONFIG_BUNDLE_REVIEW') OR created_by_user_id=?)";
  async function scopedPage(organization: string, user: string, skip: number, take: number) {
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,source_name FROM catalog_import_batches WHERE " + where +
      " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", [organization, user, take, skip]);
    return rows.map(row => row.id as string);
  }
  async function scopedCount(organization: string, user: string) {
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM catalog_import_batches WHERE " + where, [organization, user]);
    return Number(rows[0]?.total);
  }
  try {
    for (const [id, label] of [[org, "A"], [foreignOrg, "B"]]) {
      await writer.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S150-" + suffix + label, "Synthetic catalog organization"]);
    }
    for (const [id, organization, label] of [
      [actor, org, "A"], [peer, org, "B"], [foreign, foreignOrg, "C"],
    ]) {
      await writer.execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, organization, "s150-" + suffix + label, "Synthetic reviewer"]);
    }
    const own: string[] = [];
    for (let i = 1; i <= 25; i++) own.push(await insert(org, actor,
      i % 2 ? "CSV_REVIEW" : "CONFIG_BUNDLE_REVIEW", i));
    for (let i = 26; i <= 29; i++) await insert(org, peer, "CSV_REVIEW", i);
    const shared = await insert(org, peer, "LEGACY_MDB_EXPORT", 30);
    await insert(foreignOrg, foreign, "CSV_REVIEW", 31);

    assert.equal(await scopedCount(org, actor), 26);
    assert.equal(await scopedCount(org, peer), 5);
    assert.equal(await scopedCount(foreignOrg, actor), 0);
    const all = [];
    for (let page = 1; page <= 3; page++) {
      const bounds = catalogImportPageBounds(page, 26);
      all.push(...await scopedPage(org, actor, bounds.skip, bounds.take));
    }
    assert.equal(all.length, 26);
    assert.equal(new Set(all).size, 26);
    assert.deepEqual(new Set(all), new Set([...own, shared]));
    assert.deepEqual(await scopedPage(org, actor, 20, 10), [...all.slice(20)]);
    assert.ok(!all.some(id => inserted.slice(25, 29).includes(id)));

    // A new row committed after the count must not displace a page in a
    // repeatable-read transaction; count and page observe one SQL snapshot.
    await reader.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    try {
      assert.equal(await scopedCount(org, actor), 26);
      const concurrent = await insert(org, actor, "CSV_REVIEW", 32);
      const stable = await scopedPage(org, actor, 0, 10);
      assert.equal(stable.length, 10);
      assert.ok(!stable.includes(concurrent));
      assert.equal(await scopedCount(org, actor), 26);
    } finally {
      await reader.rollback();
    }
    assert.equal(await scopedCount(org, actor), 27);
  } finally {
    await writer.execute("DELETE FROM catalog_import_batches WHERE id IN (" +
      inserted.map(() => "?").join(",") + ")", inserted).catch(() => {});
    await writer.execute("DELETE FROM users WHERE username LIKE ?", ["s150-" + suffix + "%"]).catch(() => {});
    await writer.execute("DELETE FROM organizations WHERE id IN (?,?)",
      [org, foreignOrg]).catch(() => {});
    await Promise.all([writer.end(), reader.end()]);
  }
});
