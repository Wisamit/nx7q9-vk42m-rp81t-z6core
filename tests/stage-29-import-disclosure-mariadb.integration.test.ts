import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { authorizedStagedPrices } from "../src/lib/catalog-import-disclosure.ts";

test("MariaDB two connections: financial review cannot cross tenant or unauthorized branch", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), other = randomUUID(), branchA = randomUUID(), branchB = randomUUID();
  const otherBranch = randomUUID(), actor = randomUUID(), otherActor = randomUUID();
  const batch = randomUUID(), listGlobal = randomUUID(), listA = randomUUID();
  const listB = randomUUID(), listForeign = randomUUID(), suffix = org.slice(0,8);
  const prefix = "R29-" + suffix;
  const rowIds: string[] = [];
  const execute = async (sql: string, args: Array<string | number | null>) => writer.execute(sql, args);
  try {
    for (const [id, code] of [[org, "OWN"], [other, "FOREIGN"]]) {
      await execute("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id, prefix+code, "Import Financial Boundary"]);
    }
    for (const [id, tenant, code] of [
      [branchA, org, "A"], [branchB, org, "B"], [otherBranch, other, "F"],
    ]) {
      await execute("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Financial Branch"]);
    }
    for (const [id, tenant, code] of [[actor,org,"A"],[otherActor,other,"B"]]) {
      await execute("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"r29-"+code+suffix,"Financial Reviewer"]);
    }
    for (const [id, tenant, code, scope, branch] of [
      [listGlobal,org,"BASE","ORGANIZATION",null], [listA,org,"A","BRANCH",branchA],
      [listB,org,"B","BRANCH",branchB], [listForeign,other,"FOREIGN","BRANCH",otherBranch],
    ]) {
      await execute(
        "INSERT INTO price_lists (id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES (?,?,?,?,?,?,'AED','2026-01-01',NOW(3))",
        [id,tenant,prefix+code,"Financial List",scope,branch],
      );
    }
    await execute(
      "INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','private.csv','DRAFT',?,NOW(3))",
      [batch,org,actor],
    );
    for (const [i, name, amount] of [[1,"BASE","100.4500"],[2,"A","200.4500"],[3,"B","300.4500"]] as const) {
      const id=randomUUID(); rowIds.push(id);
      const candidate=JSON.stringify({ priceListCode: prefix+name, testCode: "TEST", unitPrice: amount });
      await execute(
        "INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'PRICE_LIST_ITEM','WARNING',?,?,NOW(3))",
        [id,batch,i,candidate,candidate],
      );
    }
    const [stored]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT normalized_data FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",
      [batch],
    );
    const candidates = stored.map(row => typeof row.normalized_data === "string"
      ? JSON.parse(row.normalized_data) : row.normalized_data);
    assert.equal(candidates.length,3);
    const [tenantLists] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT code,branch_id FROM price_lists WHERE organization_id=?",
      [org],
    );
    const lists = tenantLists.map(row => ({code:String(row.code),branchId:row.branch_id as string | null}));
    assert.equal(lists.length,3);
    assert.equal(authorizedStagedPrices(candidates,lists,new Set([branchA])),false);
    assert.equal(authorizedStagedPrices(candidates,lists,new Set([branchA,branchB])),true);
    const [otherTenantLists] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT code,branch_id FROM price_lists WHERE organization_id=?",[other]);
    assert.equal(authorizedStagedPrices(candidates,otherTenantLists.map(x => ({
      code:String(x.code), branchId:x.branch_id as string | null,
    })),new Set([otherBranch])),false);
    assert.equal(authorizedStagedPrices(candidates.slice(0,2),lists,new Set([branchA])),true);
    // No patient, result, invoice, or live price changes during review.
    const [live] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id IN (?,?,?,?)",
      [listGlobal,listA,listB,listForeign],
    );
    assert.equal(Number(live[0].count),0);
  } finally {
    await writer.rollback().catch(()=>{});
    await execute("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await execute("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await execute("DELETE FROM price_lists WHERE id IN (?,?,?,?)",
      [listGlobal,listA,listB,listForeign]).catch(()=>{});
    await execute("DELETE FROM users WHERE id IN (?,?)",[actor,otherActor]).catch(()=>{});
    await execute("DELETE FROM branches WHERE id IN (?,?,?)",
      [branchA,branchB,otherBranch]).catch(()=>{});
    await execute("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
