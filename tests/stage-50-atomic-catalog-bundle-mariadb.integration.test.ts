import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 50 MariaDB two sessions: configuration bundle snapshot resists mid-export edits and honors revoked live grants",
{ timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const options = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [reader, writer] = await Promise.all([
    mysql.createConnection(options), mysql.createConnection(options),
  ]);
  const org = randomUUID(), foreignOrg = randomUUID(), branchA = randomUUID(),
    branchB = randomUUID(), deptA = randomUUID(), deptB = randomUUID(),
    testA = randomUUID(), testB = randomUUID(), foreignTest = randomUUID(),
    listA = randomUUID(), listB = randomUUID(), clientList = randomUUID(),
    priceA = randomUUID(), priceB = randomUUID(), privatePrice = randomUUID(),
    actor = randomUUID();
  const prefix = "S50" + org.slice(0, 8);
  const insert = (sql: string, parameters: Array<string | number | null>) =>
    writer.execute(sql, parameters);
  try {
    for (const [id, suffix] of [[org, "A"], [foreignOrg, "F"]]) {
      await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, prefix + suffix, "Atomic export org"]);
    }
    for (const [id, tenant, suffix] of [
      [branchA, org, "A"], [branchB, org, "B"],
    ]) await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id, tenant, prefix + suffix, "Atomic export branch"]);
    for (const [id, branch, suffix] of [[deptA, branchA, "A"], [deptB, branchB, "B"]]) {
      await insert("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id, org, branch, prefix + suffix, "Atomic export department"]);
    }
    for (const [id, tenant, dept, suffix] of [
      [testA, org, deptA, "A"], [testB, org, deptB, "B"],
      [foreignTest, foreignOrg, null, "F"],
    ]) await insert("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id, tenant, dept, prefix + suffix, "Before",]);
    for (const [id, scope, branch, suffix] of [
      [listA, "ORGANIZATION", null, "A"],
      [listB, "BRANCH", branchB, "B"],
      [clientList, "CLIENT", null, "C"],
    ]) await insert("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,'AED','2026-01-01',NOW(3))",
      [id, org, prefix + suffix, "Atomic export list", scope, branch]);
    for (const [id, list, amount] of [
      [priceA, listA, "123.4500"], [priceB, listB, "777.0000"],
      [privatePrice, clientList, "999.9999"],
    ]) await insert("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?, '2026-01-01',NOW(3))",
      [id, list, testA, amount]);
    await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor, org, prefix, "Atomic export actor"]);
    await insert("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)", [actor, branchA]);
    await insert("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)", [actor, deptA]);

    await reader.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    const [locked] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [org]);
    assert.equal(locked.length, 1);
    const [granted] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT s.branch_id FROM user_branch_scopes s JOIN branches b ON b.id=s.branch_id WHERE s.user_id=? AND b.organization_id=? AND b.status='ACTIVE'",
      [actor, org]);
    assert.deepEqual(granted.map(row => String(row.branch_id)), [branchA]);
    const [clinical] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,name_en FROM lab_tests WHERE organization_id=? AND department_id=?",
      [org, deptA]);
    assert.deepEqual(clinical.map(row => String(row.id)), [testA]);
    assert.equal(clinical[0].name_en, "Before");
    const [firstPrice] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_items WHERE id=?", [priceA]);
    assert.equal(String(firstPrice[0].unit_price), "123.4500");

    // Uncoordinated direct master changes can commit while the export continues,
    // but a repeatable read must never mix their later values into this bundle.
    await insert("UPDATE lab_tests SET name_en='After' WHERE id=?", [testA]);
    await insert("UPDATE price_list_items SET unit_price='567.8901' WHERE id=?", [priceA]);
    const [snapshotTests] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?", [testA]);
    const [snapshotPrices] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_items WHERE id=?", [priceA]);
    assert.equal(snapshotTests[0].name_en, "Before");
    assert.equal(String(snapshotPrices[0].unit_price), "123.4500");
    const [outOfScope] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT p.id FROM price_list_items p JOIN price_lists l ON l.id=p.price_list_id WHERE l.organization_id=? AND ((l.scope_type='ORGANIZATION' AND l.branch_id IS NULL) OR (l.scope_type='BRANCH' AND l.branch_id=?)) ORDER BY p.id",
      [org, branchA]);
    assert.deepEqual(outOfScope.map(row => String(row.id)), [priceA]);
    await reader.commit();

    const [current] = await writer.execute<mysql.RowDataPacket[]>(
      "SELECT t.name_en,p.unit_price FROM lab_tests t JOIN price_list_items p ON p.test_id=t.id WHERE t.id=? AND p.id=?",
      [testA, priceA]);
    assert.equal(current[0].name_en, "After");
    assert.equal(String(current[0].unit_price), "567.8901");

    // Live grants supersede a stale session's formerly granted branch.
    await insert("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]);
    await reader.beginTransaction();
    const [revoked] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM user_branch_scopes WHERE user_id=?", [actor]);
    assert.equal(revoked.length, 0);
    await reader.rollback();
  } finally {
    await reader.rollback().catch(() => {});
    await writer.rollback().catch(() => {});
    await insert("DELETE FROM user_department_scopes WHERE user_id=?", [actor]).catch(() => {});
    await insert("DELETE FROM user_branch_scopes WHERE user_id=?", [actor]).catch(() => {});
    await insert("DELETE FROM price_list_items WHERE id IN (?,?,?)", [priceA, priceB, privatePrice]).catch(() => {});
    await insert("DELETE FROM price_lists WHERE id IN (?,?,?)", [listA, listB, clientList]).catch(() => {});
    await insert("DELETE FROM lab_tests WHERE id IN (?,?,?)", [testA, testB, foreignTest]).catch(() => {});
    await insert("DELETE FROM departments WHERE id IN (?,?)", [deptA, deptB]).catch(() => {});
    await insert("DELETE FROM users WHERE id=?", [actor]).catch(() => {});
    await insert("DELETE FROM branches WHERE id IN (?,?)", [branchA, branchB]).catch(() => {});
    await insert("DELETE FROM organizations WHERE id IN (?,?)", [org, foreignOrg]).catch(() => {});
    await Promise.all([reader.end(), writer.end()]);
  }
});
