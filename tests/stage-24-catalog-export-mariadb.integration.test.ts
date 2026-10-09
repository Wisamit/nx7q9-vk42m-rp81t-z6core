import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: catalog export windows preserve exact price values and isolate organizations and branch-scoped configuration", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const cfg = { host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), foreign = randomUUID();
  const branchA = randomUUID(), branchB = randomUUID(), foreignBranch = randomUUID();
  const testId = randomUUID(), foreignTest = randomUUID();
  const componentId = randomUUID(), foreignComponent = randomUUID();
  const globalList = randomUUID(), privateList = randomUUID(), foreignList = randomUUID();
  const rangeGlobal = randomUUID(), rangeA = randomUUID(), rangeB = randomUUID(), rangeForeign = randomUUID();
  const suffix = org.slice(0, 8);
  const testPriceIds: string[] = [];
  async function insert(sql: string, data: Array<string | number | null>) {
    await writer.execute(sql, data);
  }
  async function listPrices(tenant: string, allowedBranches: string[], after: string | null) {
    const scopes = allowedBranches.map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT p.id, p.unit_price AS amount, l.currency, l.branch_id AS branchId
       FROM price_list_items p INNER JOIN price_lists l ON l.id = p.price_list_id
       INNER JOIN lab_tests t ON t.id = p.test_id
       WHERE l.organization_id = ? AND t.organization_id = ?
         AND (l.branch_id IS NULL OR l.branch_id IN (${scopes}))
         AND (? IS NULL OR p.id > ?)
       ORDER BY p.id ASC LIMIT 251`,
      [tenant, tenant, ...allowedBranches, after, after],
    );
    return rows.map(row => ({
      id: String(row.id), amount: String(row.amount),
      currency: String(row.currency), branchId: row.branchId as string | null,
    }));
  }
  async function ranges(tenant: string, allowedBranches: string[]) {
    const scopes = allowedBranches.map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT ri.id, ri.low_value AS low, ri.high_value AS high, ri.branch_id AS branchId,
         ri.approval_status AS approval
       FROM reference_intervals ri
       INNER JOIN test_components c ON c.id = ri.component_id
       INNER JOIN lab_tests t ON t.id = c.test_id
       WHERE t.organization_id = ? AND (ri.branch_id IS NULL OR ri.branch_id IN (${scopes}))
       ORDER BY ri.id ASC`,
      [tenant, ...allowedBranches],
    );
    return rows;
  }

  try {
    for (const [id, code] of [[org,"A"],[foreign,"F"]])
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"EX24-"+code+suffix,"Stage24 Export"]);
    for (const [id,tenant,code] of [[branchA,org,"A"],[branchB,org,"B"],[foreignBranch,foreign,"F"]])
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"EX24-"+code+suffix,"Export Branch"]);
    for (const [id,tenant,code] of [[testId,org,"A"],[foreignTest,foreign,"F"]])
      await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"EX24-"+code+suffix,"Export Test"]);
    for (const [id,tid,code] of [[componentId,testId,"A"],[foreignComponent,foreignTest,"F"]])
      await insert("INSERT INTO test_components (id,test_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tid,"EX24-"+code+suffix,"Export Component"]);
    for (const [id,tenant,code,branch] of [
      [globalList,org,"ALL",null],
      [privateList,org,"B",branchB],
      [foreignList,foreign,"F",foreignBranch],
    ]) await insert(
      "INSERT INTO price_lists (id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES (?,?,?,?,?,?,'AED','2025-01-01',NOW(3))",
      [id,tenant,"EX24-"+code+suffix,"Export List",branch ? "BRANCH" : "ORGANIZATION",branch || null],
    );
    for (const [id,comp,branch,low] of [
      [rangeGlobal,componentId,null,"70.125000"],
      [rangeA,componentId,branchA,"71.125000"],
      [rangeB,componentId,branchB,"72.125000"],
      [rangeForeign,foreignComponent,foreignBranch,"99.999999"],
    ]) await insert(
      "INSERT INTO reference_intervals (id,component_id,branch_id,low_value,high_value,effective_from,approval_status,status,updated_at) VALUES (?,?,?,?,?,'2025-01-01','APPROVED','ACTIVE',NOW(3))",
      [id,comp,branch || null,low,"180.000000"],
    );

    // 252 effective-dated rows test true 250+1 lookahead and stable id keyset
    // pagination. No floating point parsing is allowed.
    const base = Date.UTC(2025,0,1);
    for (let index=0;index<252;index++) {
      const id=randomUUID();
      testPriceIds.push(id);
      const date = new Date(base+index*86_400_000).toISOString().slice(0,10);
      await insert("INSERT INTO price_list_items (id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,globalList,testId,index===0?"123.4500":"99.1234",date]);
    }
    const hiddenItem=randomUUID(),foreignItem=randomUUID();
    await insert("INSERT INTO price_list_items (id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES (?,?,?,'888.0000','2025-01-01',NOW(3))",
      [hiddenItem,privateList,testId]);
    await insert("INSERT INTO price_list_items (id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES (?,?,?,'777.0000','2025-01-01',NOW(3))",
      [foreignItem,foreignList,foreignTest]);

    const first=await listPrices(org,[branchA],null);
    assert.equal(first.length,251);
    const cursor=first[249].id;
    const second=await listPrices(org,[branchA],cursor);
    assert.equal(second.length,2);
    const visible=[...first.slice(0,250),...second];
    assert.equal(visible.length,252);
    assert.deepEqual(new Set(visible.map(x=>x.id)),new Set(testPriceIds));
    assert.ok(visible.every(x=>x.currency==="AED" && x.branchId===null));
    assert.ok(visible.some(x=>x.amount==="123.4500"));
    assert.ok(visible.every(x=>x.amount!=="888.0000"&&x.amount!=="777.0000"));

    const both=await listPrices(org,[branchA,branchB],null);
    assert.equal(both.length,251);
    const bothSecond=await listPrices(org,[branchA,branchB],both[249].id);
    assert.equal(new Set([...both.slice(0,250),...bothSecond].map(x=>x.id)).size,253);
    assert.equal((await listPrices(foreign,[branchA],null)).length,0);
    assert.equal((await listPrices(org,[foreignBranch],null)).length,251); // Tenant-global only.
    const clinical=await ranges(org,[branchA]);
    assert.equal(clinical.length,2);
    assert.deepEqual(new Set(clinical.map(x=>x.id)),new Set([rangeGlobal,rangeA]));
    assert.ok(clinical.some(x=>String(x.low)==="70.125000"));
    assert.ok(clinical.every(x=>x.approval==="APPROVED"));
  } finally {
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await writer.execute("DELETE FROM price_list_items WHERE price_list_id IN (?,?,?)",[globalList,privateList,foreignList]);
    await writer.execute("DELETE FROM reference_intervals WHERE id IN (?,?,?,?)",[rangeGlobal,rangeA,rangeB,rangeForeign]);
    await writer.execute("DELETE FROM price_lists WHERE id IN (?,?,?)",[globalList,privateList,foreignList]);
    await writer.execute("DELETE FROM test_components WHERE id IN (?,?)",[componentId,foreignComponent]);
    await writer.execute("DELETE FROM lab_tests WHERE id IN (?,?)",[testId,foreignTest]);
    await writer.execute("DELETE FROM branches WHERE id IN (?,?,?)",[branchA,branchB,foreignBranch]);
    await writer.execute("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]);
    await Promise.all([writer.end(),reader.end()]);
  }
});
