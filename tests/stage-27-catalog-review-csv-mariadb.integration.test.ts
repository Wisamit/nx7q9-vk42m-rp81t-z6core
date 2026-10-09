import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogReviewCsv } from "../src/lib/catalog-review-csv.ts";

test("MariaDB: controlled CSV source retains exact DECIMAL strings and excludes foreign/unauthorized branch rows", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host: url.hostname, port: Number(url.port || "3306"),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const org = randomUUID(), otherOrg = randomUUID();
  const branchA = randomUUID(), branchB = randomUUID(), otherBranch = randomUUID();
  const testId = randomUUID(), otherTestId = randomUUID();
  const allList = randomUUID(), privateList = randomUUID(), otherList = randomUUID();
  const allItem = randomUUID(), privateItem = randomUUID(), otherItem = randomUUID();
  const suffix = org.slice(0, 8);
  const formula = '=HYPERLINK("https://invalid.example","open")';
  const insert = async (sql: string, args: Array<string | null>) => { await writer.execute(sql, args); };
  try {
    for (const [id, code] of [[org, "O"], [otherOrg, "F"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id, "CSV27-" + code + suffix, "CSV Review Tenant"]);
    }
    for (const [id, organizationId, code] of [
      [branchA,org,"A"], [branchB,org,"B"], [otherBranch,otherOrg,"F"],
    ]) {
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,organizationId,"CSV27-"+code+suffix,"CSV Review Branch"]);
    }
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"CSV27-T-"+suffix,formula]);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [otherTestId,otherOrg,"CSV27-F-"+suffix,"Foreign Test"]);
    for (const [id, tenant, code, scope, branch] of [
      [allList,org,"ALL","ORGANIZATION",null],
      [privateList,org,"B","BRANCH",branchB],
      [otherList,otherOrg,"F","BRANCH",otherBranch],
    ]) {
      await insert("INSERT INTO price_lists (id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES (?,?,?,?,?,?,'AED','2025-01-01',NOW(3))",
        [id,tenant,"CSV27-"+code+suffix,"CSV Review List",scope,branch]);
    }
    for (const [id, list, testIdForItem, price] of [
      [allItem,allList,testId,"123.4500"],
      [privateItem,privateList,testId,"999.1234"],
      [otherItem,otherList,otherTestId,"888.1234"],
    ]) {
      await insert("INSERT INTO price_list_items (id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES (?,?,?,?, '2026-10-09',NOW(3))",
        [id,list,testIdForItem,price]);
    }
    // A second independent connection performs the equivalent organization + branch
    // scope predicate used by the configuration-export API.
    const [matched] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT p.id, p.unit_price AS amount, l.code AS listCode, l.currency, t.code AS testCode,
         t.name_en AS testName
        FROM price_list_items p
        INNER JOIN price_lists l ON l.id = p.price_list_id
        INNER JOIN lab_tests t ON t.id = p.test_id
        WHERE l.organization_id = ? AND t.organization_id = ?
          AND (l.branch_id IS NULL OR l.branch_id IN (?))
        ORDER BY p.id ASC`,
      [org,org,branchA]);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, allItem);
    assert.equal(String(matched[0].amount), "123.4500");
    const csv = catalogReviewCsv({ entityType: "PRICE_LIST_ITEM",
      records: matched.map(row => ({
        id: row.id, unitPrice: String(row.amount),
        priceList: { code: row.listCode, currency: row.currency },
        test: { code: row.testCode, nameEn: row.testName },
      })) }, org, "2026-10-09T00:00:00.000Z");
    assert.match(csv, /"123\.4500"/);
    assert.match(csv, /"'=HYPERLINK\(""https:\/\/invalid\.example"",""open""\)"/);
    assert.ok(!csv.includes("999.1234") && !csv.includes("888.1234"));
    const [foreignResult] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT p.id FROM price_list_items p JOIN price_lists l ON l.id=p.price_list_id WHERE l.organization_id=? AND p.id=?",
      [org,otherItem]);
    assert.equal(foreignResult.length, 0);
  } finally {
    await writer.execute("DELETE FROM price_list_items WHERE id IN (?,?,?)", [allItem,privateItem,otherItem]).catch(()=>{});
    await writer.execute("DELETE FROM price_lists WHERE id IN (?,?,?)", [allList,privateList,otherList]).catch(()=>{});
    await writer.execute("DELETE FROM lab_tests WHERE id IN (?,?)", [testId,otherTestId]).catch(()=>{});
    await writer.execute("DELETE FROM branches WHERE id IN (?,?,?)", [branchA,branchB,otherBranch]).catch(()=>{});
    await writer.execute("DELETE FROM organizations WHERE id IN (?,?)", [org,otherOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
