import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { genericCatalogPriceScope } from "../src/lib/catalog-generic-price-scope.ts";

test("Stage 146 MariaDB: public review identity resolves no private, foreign or ungranted tariffs", {
  timeout: 90000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  });
  const org = randomUUID(), foreign = randomUUID();
  const branch = randomUUID(), otherBranch = randomUUID();
  const client = randomUUID(), source = randomUUID(), referrer = randomUUID();
  const priceIds = Array.from({ length: 8 }, () => randomUUID());
  const cleanup: Array<[string, string]> = [];
  const tag = org.slice(0, 8);
  async function add(table: string, id: string, query: string, values: Array<string | null>) {
    await db.execute(query, values);
    cleanup.unshift([table, id]);
  }
  try {
    for (const [id, code] of [[org, "A"], [foreign, "B"]]) {
      await add("organizations", id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S146" + tag + code, "Synthetic organization"]);
    }
    for (const [id, code] of [[branch, "A"], [otherBranch, "B"]]) {
      await add("branches", id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, "S146" + tag + code, "Synthetic branch"]);
    }
    await add("clients", client,
      "INSERT INTO clients(id,organization_id,code,name_en,type,payment_terms_days,updated_at) " +
      "VALUES(?,?,?,?,'COMPANY',30,NOW(3))",
      [client, org, "S146" + tag + "C", "Synthetic client"]);
    await add("order_sources", source,
      "INSERT INTO order_sources(id,organization_id,code,name_en,category,updated_at) " +
      "VALUES(?,?,?,?,?,NOW(3))",
      [source, org, "S146" + tag + "S", "Synthetic source", "WALK_IN"]);
    await add("referrers", referrer,
      "INSERT INTO referrers(id,organization_id,code,name_en,type,updated_at) " +
      "VALUES(?,?,?,?,? ,NOW(3))",
      [referrer, org, "S146" + tag + "R", "Synthetic referrer", "PHYSICIAN"]);
    const tariffSql = "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type," +
      "branch_id,source_id,client_id,referrer_id,currency,priority,effective_from,updated_at) " +
      "VALUES(?,?,?,?,?,?,?,?,?,'AED',1,'2026-01-01',NOW(3))";
    const entries: Array<[string, string, string, string | null, string | null, string | null, string | null]> = [
      [priceIds[0], org, "ORGANIZATION", null, null, null, null],
      [priceIds[1], org, "BRANCH", branch, null, null, null],
      [priceIds[2], org, "BRANCH", otherBranch, null, null, null],
      [priceIds[3], org, "ORGANIZATION", null, null, client, null],
      [priceIds[4], org, "BRANCH", branch, source, null, null],
      [priceIds[5], org, "ORGANIZATION", null, null, null, referrer],
      [priceIds[6], foreign, "ORGANIZATION", null, null, null, null],
      [priceIds[7], org, "BRANCH", branch, null, client, null],
    ];
    for (const [i, [id, tenant, kind, branchId, sourceId, clientId, referrerId]] of entries.entries()) {
      await add("price_lists", id, tariffSql, [
        id, tenant, "S146" + tag + i, "Synthetic tariff", kind,
        branchId, sourceId, clientId, referrerId,
      ]);
    }
    const predicate = genericCatalogPriceScope([branch]);
    assert.deepEqual(predicate.OR[1].branchId, { in: [branch] });
    const sql = "SELECT id FROM price_lists WHERE organization_id=? " +
      "AND source_id IS NULL AND referrer_id IS NULL AND client_id IS NULL " +
      "AND contract_id IS NULL AND ((scope_type='ORGANIZATION' AND branch_id IS NULL) " +
      "OR (scope_type='BRANCH' AND branch_id IN (?)))";
    const [visible] = await db.execute<mysql.RowDataPacket[]>(sql, [org, branch]);
    assert.deepEqual(visible.map(row => row.id).sort(), [priceIds[0], priceIds[1]].sort());
    const [foreignVisible] = await db.execute<mysql.RowDataPacket[]>(sql, [foreign, branch]);
    assert.deepEqual(foreignVisible.map(row => row.id), [priceIds[6]]);
    const [oldBroad] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_lists WHERE organization_id=? AND " +
      "((scope_type='ORGANIZATION' AND branch_id IS NULL) OR " +
      "(scope_type='BRANCH' AND branch_id=?))", [org, branch]);
    assert.ok(oldBroad.length > visible.length, "the old review lookup admitted private prices");
  } finally {
    for (const [table, id] of cleanup) {
      await db.execute("DELETE FROM " + table + " WHERE id=?", [id]).catch(() => {});
    }
    await db.end();
  }
});
