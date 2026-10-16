import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 145 MariaDB: generic catalog export excludes private tariffs regardless of broad scopeType", {
  timeout: 90000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
  });
  const org = randomUUID(), otherOrg = randomUUID(),
    branch = randomUUID(), ungrantedBranch = randomUUID(), suffix = org.slice(0, 8),
    source = randomUUID(), client = randomUUID(), referrer = randomUUID();
  const priceIds = {
    organization: randomUUID(), branch: randomUUID(), client: randomUUID(),
    source: randomUUID(), referrer: randomUUID(), ungranted: randomUUID(),
    foreign: randomUUID(),
  };
  const created: Array<{ table: string; id: string }> = [];
  async function add(table: string, id: string, sql: string, params: (string | null)[]) {
    await db.execute(sql, params);
    created.unshift({ table, id });
  }
  try {
    for (const [id, key] of [[org, "OWN"], [otherOrg, "OTHER"]]) {
      await add("organizations", id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S145" + suffix + key, "Synthetic Stage 145 tenant"]);
    }
    for (const [id, key] of [[branch, "ACTIVE"], [ungrantedBranch, "NO_GRANT"]]) {
      await add("branches", id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, "S145" + suffix + key, "Synthetic branch"]);
    }
    await add("order_sources", source,
      "INSERT INTO order_sources(id,organization_id,code,name_en,category,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [source, org, "S145SRC" + suffix, "Synthetic source", "WALK_IN"]);
    await add("clients", client,
      "INSERT INTO clients(id,organization_id,code,name_en,type,payment_terms_days,updated_at) "+
      "VALUES(?,?,?,?,'COMPANY',30,NOW(3))",
      [client, org, "S145CL" + suffix, "Synthetic client"]);
    await add("referrers", referrer,
      "INSERT INTO referrers(id,organization_id,code,name_en,type,updated_at) "+
      "VALUES(?,?,?,?,'PHYSICIAN',NOW(3))",
      [referrer, org, "S145RF" + suffix, "Synthetic referrer"]);
    const tariffSql = "INSERT INTO price_lists("+
      "id,organization_id,code,name_en,scope_type,branch_id,source_id,client_id,referrer_id,"+
      "currency,priority,effective_from,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,'AED',10,'2026-01-01',NOW(3))";
    const cases: Array<[string, string, string, string | null, string | null, string | null, string | null]> = [
      [priceIds.organization, org, "ORGANIZATION", null, null, null, null],
      [priceIds.branch, org, "BRANCH", branch, null, null, null],
      [priceIds.client, org, "ORGANIZATION", null, null, client, null],
      [priceIds.source, org, "BRANCH", branch, source, null, null],
      [priceIds.referrer, org, "ORGANIZATION", null, null, null, referrer],
      [priceIds.ungranted, org, "BRANCH", ungrantedBranch, null, null, null],
      [priceIds.foreign, otherOrg, "ORGANIZATION", null, null, null, null],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [id, tenant, scope, branchId, sourceId, clientId, referrerId] = cases[i];
      await add("price_lists", id, tariffSql, [
        id, tenant, "S145" + suffix + String(i), "Synthetic tariff", scope,
        branchId, sourceId, clientId, referrerId,
      ]);
    }
    const [incorrectScope] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_lists WHERE organization_id=? AND "+
      "((scope_type='ORGANIZATION' AND branch_id IS NULL) OR "+
      "(scope_type='BRANCH' AND branch_id=?))",
      [org, branch]);
    assert.equal(incorrectScope.length, 5,
      "a broad scopeType alone would leak client, source and referrer tariffs");
    const safeSql = "SELECT id FROM price_lists WHERE organization_id=? AND "+
      "source_id IS NULL AND referrer_id IS NULL AND client_id IS NULL AND contract_id IS NULL AND "+
      "((scope_type='ORGANIZATION' AND branch_id IS NULL) OR "+
      "(scope_type='BRANCH' AND branch_id IN (?))) ORDER BY id";
    const [safeRows] = await db.execute<mysql.RowDataPacket[]>(safeSql, [org, branch]);
    assert.deepEqual(safeRows.map(row => row.id).sort(),
      [priceIds.organization, priceIds.branch].sort(),
      "only public tariffs for this tenant and active granted branch may be projected");
    const [otherBranchScope] = await db.execute<mysql.RowDataPacket[]>(
      safeSql, [org, ungrantedBranch]);
    assert.deepEqual(otherBranchScope.map(row => row.id).sort(),
      [priceIds.organization, priceIds.ungranted].sort(),
      "branch switching must not retain prices from a different grant set");
    const [foreignTenant] = await db.execute<mysql.RowDataPacket[]>(safeSql, [otherOrg, branch]);
    assert.deepEqual(foreignTenant.map(row => row.id), [priceIds.foreign],
      "another tenant must not see any of the owner's tariffs");
  } finally {
    for (const item of created) {
      await db.execute("DELETE FROM " + item.table + " WHERE id=?", [item.id]).catch(() => {});
    }
    await db.end();
  }
});
