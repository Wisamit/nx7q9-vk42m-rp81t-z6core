import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 126 MariaDB: row identity uniqueness, tenant isolation, concurrent CAS, and tariff snapshots",
  { timeout: 90000 }, async () => {
    if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url = new URL(process.env.DATABASE_URL);
    const config = { host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) };
    const [a, b] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
    const org = randomUUID(), other = randomUUID(), row = randomUUID(), otherRow = randomUUID();
    const p = randomUUID(), list = randomUUID(), tariff = randomUUID();
    const source = "1".repeat(64), digest = "2".repeat(64), key = "3".repeat(64), schema = "4".repeat(64);
    const cleanup: Array<[string, string, string]> = [];
    async function add(table: string, id: string, sql: string, params: Array<string | number | null>) {
      await a.execute(sql, params);
      cleanup.unshift([table, "id", id]);
    }
    try {
      for (const [id, postfix] of [[org, "A"], [other, "B"]]) {
        await add("organizations", id,
          "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id, "S126" + org.slice(0, 10) + postfix, "Synthetic laboratory"]);
      }
      await add("commercial_packages", p,
        "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [p, org, "S126PKG", "Synthetic panel-free package"]);
      await add("price_lists", list,
        "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,currency,effective_from,updated_at) " +
        "VALUES(?,?,?,?,?,'AED','2026-01-01',NOW(3))",
        [list, org, "S126PUBLIC", "Synthetic tariff list", "ORGANIZATION"]);
      await add("price_list_package_items", tariff,
        "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) " +
        "VALUES(?,?,?,?,'2026-01-01',NOW(3))",
        [tariff, list, p, "123.4567"]);
      const insert = "INSERT INTO legacy_catalog_row_lineage(" +
        "id,organization_id,source_sha256,source_table,source_schema_sha256,digest_key_id," +
        "row_digest,occurrence,classification,created_by_user_id,updated_at) " +
        "VALUES(?,?,?,?,?,?,?,?,?,'synthetic-actor',NOW(3))";
      await add("legacy_catalog_row_lineage", row, insert,
        [row, org, source, "price", schema, key, digest, 1, "UNRESOLVED"]);
      await add("legacy_catalog_row_lineage", otherRow, insert,
        [otherRow, other, source, "price", schema, key, digest, 1, "UNRESOLVED"]);
      await assert.rejects(() => b.execute(insert,
        [randomUUID(), org, source, "price", schema, key, digest, 1, "UNRESOLVED"]),
      (e: unknown) => (e as { code?: string }).code === "ER_DUP_ENTRY");

      const [own] = await a.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM legacy_catalog_row_lineage WHERE organization_id=? AND source_sha256=?",
        [org, source]);
      assert.deepEqual(own.map(x => x.id), [row]);
      const [unknown] = await a.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM legacy_catalog_row_lineage WHERE organization_id=? AND id=?", [org, otherRow]);
      assert.equal(unknown.length, 0);

      await a.beginTransaction();
      const [lock] = await a.execute<mysql.RowDataPacket[]>(
        "SELECT revision FROM legacy_catalog_row_lineage WHERE id=? FOR UPDATE", [row]);
      assert.equal(lock[0].revision, 0);
      const competing = b.execute<mysql.ResultSetHeader>(
        "UPDATE legacy_catalog_row_lineage SET classification='AMBIGUOUS',revision=revision+1,updated_at=NOW(3) " +
        "WHERE id=? AND organization_id=? AND revision=0", [row, org]);
      const [winner] = await a.execute<mysql.ResultSetHeader>(
        "UPDATE legacy_catalog_row_lineage SET classification='MAPPED',target_type='PRICE_LIST_PACKAGE_ITEM'," +
        "target_id=?,revision=revision+1,updated_at=NOW(3) WHERE id=? AND revision=0",
        [tariff, row]);
      assert.equal(winner.affectedRows, 1);
      await a.commit();
      const [loser] = await competing;
      assert.equal(loser.affectedRows, 0, "second connection must not overwrite claimed revision");

      const [state] = await b.execute<mysql.RowDataPacket[]>(
        "SELECT revision,classification,target_type,target_id FROM legacy_catalog_row_lineage " +
        "WHERE id=? AND organization_id=?", [row, org]);
      assert.equal(state[0].revision, 1);
      assert.equal(state[0].classification, "MAPPED");
      assert.equal(state[0].target_id, tariff);

      // Lineage reviews never edit live money, effective dates or currency.
      const [prices] = await b.execute<mysql.RowDataPacket[]>(
        "SELECT p.unit_price,p.effective_from,l.currency,l.scope_type FROM price_list_package_items p " +
        "JOIN price_lists l ON l.id=p.price_list_id WHERE p.id=? AND l.organization_id=?",
        [tariff, org]);
      assert.equal(String(prices[0].unit_price), "123.4567");
      assert.equal(prices[0].currency, "AED");
      assert.equal(prices[0].scope_type, "ORGANIZATION");

      await a.beginTransaction();
      await a.execute(
        "UPDATE legacy_catalog_row_lineage SET classification='NOT_IMPORTED',revision=revision+1," +
        "updated_at=NOW(3) WHERE id=?", [otherRow]);
      await a.rollback();
      const [rolled] = await b.execute<mysql.RowDataPacket[]>(
        "SELECT classification,revision FROM legacy_catalog_row_lineage WHERE id=?", [otherRow]);
      assert.equal(rolled[0].classification, "UNRESOLVED");
      assert.equal(rolled[0].revision, 0);
    } finally {
      try { await a.rollback(); } catch { /* no active transaction */ }
      for (const [table, column, id] of cleanup) {
        await a.execute("DELETE FROM `" + table + "` WHERE `" + column + "`=?", [id]).catch(() => undefined);
      }
      await Promise.all([a.end(), b.end()]);
    }
  });
