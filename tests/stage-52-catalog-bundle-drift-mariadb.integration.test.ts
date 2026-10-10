import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogBundleDrift } from "../src/lib/catalog-bundle-drift.ts";

test("Stage 52 MariaDB two sessions: source-to-live drift uses consistent values and revoked live scopes deny review",
{ timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const config = { host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) };
  const [first, second] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const org = randomUUID(), otherOrg = randomUUID(), branch = randomUUID(),
    department = randomUUID(), testId = randomUUID(), otherTest = randomUUID(),
    unit = randomUUID(), component = randomUUID(), interval = randomUUID(),
    list = randomUUID(), privateList = randomUUID(), price = randomUUID(),
    privatePrice = randomUUID(), actor = randomUUID();
  const code = "S52" + org.slice(0, 8);
  const insert = (sql: string, args: Array<string | number | null>) => first.execute(sql, args);
  try {
    for (const [id, suffix] of [[org, "A"], [otherOrg, "B"]])
      await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, code + suffix, "Stage 52 Organization"]);
    await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, code + "B", "Stage 52 Branch"]);
    await insert("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [department, org, branch, code + "D", "Stage 52 Department"]);
    for (const [id, tenant, dept, suffix] of [
      [testId, org, department, "T"], [otherTest, otherOrg, null, "F"],
    ]) await insert("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id, tenant, dept, code + suffix, "Original test"]);
    await insert("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unit, org, code + "U", "mg/dL"]);
    await insert("INSERT INTO test_components(id,test_id,code,name_en,unit_id,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [component, testId, code + "C", "Glucose", unit]);
    await insert("INSERT INTO reference_intervals(id,component_id,branch_id,low_value,high_value,effective_from,approval_status,status,updated_at) VALUES(?,?,?,?,?,'2026-01-01','APPROVED','ACTIVE',NOW(3))",
      [interval, component, branch, "70.000000", "130.000000"]);
    for (const [id, type, b, suffix] of [
      [list, "BRANCH", branch, "P"], [privateList, "CLIENT", null, "V"],
    ]) await insert("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,'AED','2026-01-01',NOW(3))",
      [id, org, code + suffix, "Stage 52 Prices", type, b]);
    for (const [id, priceListId, amount] of [
      [price, list, "123.4500"], [privatePrice, privateList, "9999.9999"],
    ]) await insert("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,'2026-01-01',NOW(3))",
      [id, priceListId, testId, amount]);
    await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor, org, code, "Stage 52 Reviewer"]);
    await insert("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)", [actor, branch]);
    await insert("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)", [actor, department]);

    // Stage 49 organization row serialization: revocation must become visible
    // to the second connection once it obtains the lock.
    await first.beginTransaction();
    const [lock] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    assert.equal(lock.length, 1);
    await second.execute("SET SESSION innodb_lock_wait_timeout=8");
    await second.beginTransaction();
    const waiting = second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    await first.execute("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]);
    await first.execute("DELETE FROM user_department_scopes WHERE user_id=?", [actor]);
    await first.commit();
    const [acquired] = await waiting;
    assert.equal(acquired.length, 1);
    const [granted] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM user_branch_scopes WHERE user_id=?", [actor]);
    assert.equal(granted.length, 0);
    await second.commit();

    // Reauthorization is explicit and cannot be inferred from stale memory.
    await insert("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)", [actor, branch]);
    await insert("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)", [actor, department]);
    await second.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await second.beginTransaction();
    const [relock] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE", [org]);
    assert.equal(relock.length, 1);
    const [scoped] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT t.id,t.name_en FROM lab_tests t JOIN user_department_scopes d ON d.department_id=t.department_id JOIN user_branch_scopes b ON b.branch_id=? WHERE t.organization_id=? AND t.id=? AND d.user_id=? AND b.user_id=?",
      [branch, org, testId, actor, actor]);
    assert.equal(scoped.length, 1);
    const [limits] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT low_value FROM reference_intervals WHERE id=? AND branch_id=?", [interval, branch]);
    const [amount] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT p.unit_price FROM price_list_items p JOIN price_lists l ON l.id=p.price_list_id WHERE p.id=? AND l.organization_id=? AND l.scope_type='BRANCH' AND l.branch_id=?",
      [price, org, branch]);
    const [hidden] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT p.id FROM price_list_items p JOIN price_lists l ON l.id=p.price_list_id WHERE p.id=? AND l.scope_type IN ('ORGANIZATION','BRANCH')",
      [privatePrice]);
    assert.equal(hidden.length, 0);
    assert.equal(String(limits[0].low_value), "70.000000");
    assert.equal(String(amount[0].unit_price), "123.4500");

    // Uncoordinated writes after the snapshot must not mix partial new values.
    await insert("UPDATE reference_intervals SET low_value='72.500000' WHERE id=?", [interval]);
    await insert("UPDATE price_list_items SET unit_price='125.0000' WHERE id=?", [price]);
    const [oldLimit] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT low_value FROM reference_intervals WHERE id=?", [interval]);
    const [oldPrice] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_items WHERE id=?", [price]);
    assert.equal(String(oldLimit[0].low_value), "70.000000");
    assert.equal(String(oldPrice[0].unit_price), "123.4500");
    await second.commit();
    const [changedLimit] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT low_value FROM reference_intervals WHERE id=?", [interval]);
    const [changedPrice] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_items WHERE id=?", [price]);
    assert.deepEqual(catalogBundleDrift(
      { lowValue: "70.000000", price: "123.4500" },
      { lowValue: String(changedLimit[0].low_value), price: String(changedPrice[0].unit_price) },
    ).changedFields, ["lowValue", "price"]);
    const [foreign] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE organization_id=? AND id=?", [org, otherTest]);
    assert.equal(foreign.length, 0);
  } finally {
    await first.rollback().catch(() => {});
    await second.rollback().catch(() => {});
    await insert("DELETE FROM user_department_scopes WHERE user_id=?", [actor]).catch(() => {});
    await insert("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]).catch(() => {});
    await insert("DELETE FROM price_list_items WHERE id IN (?,?)", [price, privatePrice]).catch(() => {});
    await insert("DELETE FROM price_lists WHERE id IN (?,?)", [list, privateList]).catch(() => {});
    await insert("DELETE FROM reference_intervals WHERE id=?", [interval]).catch(() => {});
    await insert("DELETE FROM test_components WHERE id=?", [component]).catch(() => {});
    await insert("DELETE FROM units WHERE id=?", [unit]).catch(() => {});
    await insert("DELETE FROM lab_tests WHERE id IN (?,?)", [testId, otherTest]).catch(() => {});
    await insert("DELETE FROM departments WHERE id=?", [department]).catch(() => {});
    await insert("DELETE FROM users WHERE id=?", [actor]).catch(() => {});
    await insert("DELETE FROM branches WHERE id=?", [branch]).catch(() => {});
    await insert("DELETE FROM organizations WHERE id IN (?,?)", [org, otherOrg]).catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
});
