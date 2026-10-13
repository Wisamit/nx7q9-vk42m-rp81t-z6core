import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { sameCompositeMembership } from "../src/lib/catalog-composite-bundle.ts";

test("Stage 117 MariaDB: scoped composite links, repeatable-read drift, and private tariffs",
  { timeout: 90000 }, async () => {
    if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url = new URL(process.env.DATABASE_URL);
    const config = { host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) };
    const [reader, writer] = await Promise.all([
      mysql.createConnection(config), mysql.createConnection(config),
    ]);
    const org = randomUUID(), foreign = randomUUID(), a = randomUUID(), b = randomUUID();
    const depA = randomUUID(), depB = randomUUID(), ta = randomUUID(), tb = randomUUID();
    const panel = randomUUID(), pack = randomUUID(), list = randomUUID(), privateList = randomUUID();
    const tariff = randomUUID(), hiddenTariff = randomUUID(), suffix = org.slice(0, 8);
    const cleanup: Array<[string, string, string]> = [];
    async function add(table: string, id: string, sql: string, params: Array<string | null>,
      column = "id") {
      await writer.execute(sql, params);
      cleanup.unshift([table, column, id]);
    }
    try {
      for (const [id, code] of [[org, "A"], [foreign, "B"]]) {
        await add("organizations", id,
          "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id, "S117" + suffix + code, "Synthetic organization"]);
      }
      for (const [id, code] of [[a, "A"], [b, "B"]]) {
        await add("branches", id,
          "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id, org, "S117" + suffix + code, "Synthetic branch"]);
      }
      for (const [id, code, branch] of [[depA, "A", a], [depB, "B", b]]) {
        await add("departments", id,
          "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id, org, branch, "S117" + suffix + code, "Synthetic department"]);
      }
      for (const [id, code, department] of [[ta, "A", depA], [tb, "B", depB]]) {
        await add("lab_tests", id,
          "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id, org, department, "S117" + suffix + code, "Synthetic test"]);
      }
      await add("test_panels", panel,
        "INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [panel, org, "S117" + suffix + "P", "Synthetic panel"]);
      await add("commercial_packages", pack,
        "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [pack, org, "S117" + suffix + "K", "Synthetic package"]);
      for (const tid of [ta, tb]) {
        await add("test_panel_items", panel,
          "INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES(?,?,1,TRUE)",
          [panel, tid], "panel_id");
        await add("commercial_package_items", pack,
          "INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,1)",
          [pack, tid], "package_id");
      }
      for (const [id, code, scope] of [[list, "P", "ORGANIZATION"], [privateList, "C", "CLIENT"]]) {
        await add("price_lists", id,
          "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,currency,effective_from,updated_at) VALUES(?,?,?,?,?,'AED','2025-01-01',NOW(3))",
          [id, org, "S117" + suffix + code, "Synthetic price list", scope]);
      }
      for (const [id, lid, amount] of [[tariff, list, "123.4567"], [hiddenTariff, privateList, "987.6543"]]) {
        await add("price_list_package_items", id,
          "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?, '2025-01-01',NOW(3))",
          [id, lid, pack, amount]);
      }
      const [authorized] = await reader.execute<mysql.RowDataPacket[]>(
        "SELECT p.id FROM test_panels p WHERE p.organization_id=? AND EXISTS (" +
        "SELECT 1 FROM test_panel_items i JOIN lab_tests t ON t.id=i.test_id " +
        "WHERE i.panel_id=p.id AND t.department_id=?) AND NOT EXISTS (" +
        "SELECT 1 FROM test_panel_items i JOIN lab_tests t ON t.id=i.test_id " +
        "WHERE i.panel_id=p.id AND t.department_id<>?)",
        [org, depA, depA]);
      assert.equal(authorized.length, 0, "mixed-department panel must fail all-member authorization");
      const [tariffs] = await reader.execute<mysql.RowDataPacket[]>(
        "SELECT i.id,i.unit_price,l.currency FROM price_list_package_items i " +
        "JOIN price_lists l ON l.id=i.price_list_id JOIN commercial_packages p ON p.id=i.package_id " +
        "WHERE p.id=? AND p.organization_id=? AND l.organization_id=? " +
        "AND l.scope_type='ORGANIZATION' AND l.branch_id IS NULL " +
        "AND l.source_id IS NULL AND l.referrer_id IS NULL AND l.client_id IS NULL " +
        "AND l.contract_id IS NULL",
        [pack, org, org]);
      assert.deepEqual(tariffs.map(row => row.id), [tariff]);
      assert.equal(String(tariffs[0].unit_price), "123.4567");
      assert.equal(tariffs[0].currency, "AED");

      const readMembers = async () => {
        const [rows] = await reader.execute<mysql.RowDataPacket[]>(
          "SELECT i.test_id,i.display_order,i.required,t.code " +
          "FROM test_panel_items i JOIN lab_tests t ON t.id=i.test_id " +
          "WHERE i.panel_id=? ORDER BY i.test_id", [panel]);
        return rows.map(row => ({
          testId: row.test_id as string, testCode: row.code as string,
          displayOrder: Number(row.display_order), required: Boolean(row.required),
        }));
      };
      await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await reader.beginTransaction();
      const original = await readMembers();
      await writer.execute(
        "UPDATE test_panel_items SET display_order=12 WHERE panel_id=? AND test_id=?",
        [panel, ta]);
      assert.equal(sameCompositeMembership(original, await readMembers(), "PANEL"), true,
        "a review transaction must see a coherent membership snapshot");
      await reader.commit();
      const changed = await readMembers();
      assert.equal(sameCompositeMembership(original, changed, "PANEL"), false,
        "changed ordered membership must not silently pass the stale source check");
    } finally {
      await reader.rollback().catch(() => {});
      for (const [table, column, id] of cleanup) {
        await writer.execute("DELETE FROM " + table + " WHERE " + column + "=?", [id]).catch(() => {});
      }
      await Promise.all([reader.end(), writer.end()]);
    }
  });
