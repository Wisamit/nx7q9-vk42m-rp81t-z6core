import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  reconcilePriceCandidate, overlaps, type PriceCandidate,
} from "../src/lib/price-import-reconciliation.ts";

test("MariaDB price staging: tenant/branch isolation, exact decimal, concurrent reader and 100+1 pages", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const uri = new URL(process.env.DATABASE_URL);
  const cfg = { host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), other = randomUUID(), actor = randomUUID();
  const otherActor = randomUUID(), listId = randomUUID(), otherList = randomUUID();
  const testId = randomUUID(), foreignTest = randomUUID();
  const branchId = randomUUID(), foreignBranch = randomUUID(), existingId = randomUUID();
  const batch = randomUUID(), foreignBatch = randomUUID();
  const suffix = org.slice(0,8), code = "PL26-" + suffix;
  const cleanup: Array<{ table: string; id: string }> = [];
  async function insert(sql: string, args: Array<string | number>, table: string, id: string) {
    await writer.execute(sql, args);
    cleanup.unshift({ table, id });
  }
  try {
    for (const [id, key] of [[org, "A"], [other, "B"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,code+key,"Pricing Reconciliation Organization"],"organizations",id);
    }
    for (const [id, owner, key] of [[actor,org,"A"],[otherActor,other,"B"]]) {
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"price26-"+key+suffix,"Price Importer"],"users",id);
    }
    for (const [id, owner, key] of [[branchId,org,"A"],[foreignBranch,other,"B"]]) {
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"P26-"+suffix+"-"+key,"Branch "+key],"branches",id);
    }
    for (const [id,owner,key] of [[testId,org,"A"],[foreignTest,other,"B"]]) {
      await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"T-"+suffix,"Price Test "+key],"lab_tests",id);
    }
    for (const [id,owner,branch,key] of [[listId,org,branchId,"A"],[otherList,other,foreignBranch,"B"]]) {
      await insert(
        "INSERT INTO price_lists (id,organization_id,branch_id,code,name_en,currency,effective_from,updated_at) VALUES (?,?,?,?,?,'AED','2026-01-01',NOW(3))",
        [id,owner,branch,"L-"+suffix,"Price List "+key],"price_lists",id);
    }
    await insert(
      "INSERT INTO price_list_items (id,price_list_id,test_id,unit_price,effective_from,effective_to,updated_at) VALUES (?,?,?,'1.2300','2026-09-01','2026-09-30',NOW(3))",
      [existingId,listId,testId],"price_list_items",existingId,
    );
    for (const [id,owner,user,key] of [[batch,org,actor,"A"],[foreignBatch,other,otherActor,"B"]]) {
      await insert(
        "INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,created_by_user_id,updated_at) VALUES (?,?,'JSON',?,?,NOW(3))",
        [id,owner,"Price "+key,user],"catalog_import_batches",id,
      );
    }
    for (let n=1;n<=102;n++) {
      const id=randomUUID();
      const from=n===1||n===102?"2026-10-01":n===2?"2026-09-10":"2027-01-01";
      const to=n===1||n===102?"2026-10-31":n===2?"2026-09-20":"2027-01-01";
      const normalized=JSON.stringify({
        priceListCode:"L-"+suffix,testCode:"T-"+suffix,
        unitPrice:"12345678901234.1234",effectiveFrom:from,effectiveTo:to,
      });
      await insert(
        "INSERT INTO catalog_import_rows (id,batch_id,\x60row_number\x60,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'PRICE_LIST_ITEM','WARNING',?,?,NOW(3))",
        [id,batch,n,normalized,normalized],"catalog_import_rows",id,
      );
    }
    const foreignRow=randomUUID(), foreignNormalized=JSON.stringify({
      priceListCode:"L-"+suffix,testCode:"T-"+suffix,unitPrice:"9.99",
      effectiveFrom:"2026-10-01",effectiveTo:"2026-10-31",
    });
    await insert(
      "INSERT INTO catalog_import_rows (id,batch_id,\x60row_number\x60,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,1,'PRICE_LIST_ITEM','WARNING',?,?,NOW(3))",
      [foreignRow,foreignBatch,foreignNormalized,foreignNormalized],"catalog_import_rows",foreignRow,
    );
    const load=async(after: number) => {
      const [rows] = await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,\x60row_number\x60,normalized_data FROM catalog_import_rows WHERE batch_id=? AND entity_type='PRICE_LIST_ITEM' AND \x60row_number\x60>? ORDER BY \x60row_number\x60,id LIMIT 101",
        [batch,after],
      );
      return rows;
    };
    const first=await load(0), last=await load(100);
    assert.equal(first.length,101);
    assert.equal(last.length,2);
    assert.equal(new Set([...first.slice(0,100),...last].map(r=>r.id)).size,102);
    assert.ok(![...first,...last].some(r=>r.id===foreignRow));

    const [lists]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,status,currency,effective_from,effective_to FROM price_lists WHERE organization_id=? AND (branch_id IS NULL OR branch_id=?)",
      [org,branchId],
    );
    const [tests]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,status FROM lab_tests WHERE organization_id=?",[org],
    );
    const [existing]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price,effective_from,effective_to FROM price_list_items WHERE price_list_id=? AND test_id=?",
      [listId,testId],
    );
    assert.equal(String(existing[0].unit_price),"1.2300");
    const index = {
      lists: new Map(lists.map(r=>[String(r.code).toUpperCase(),{
        id:String(r.id),status:String(r.status),currency:String(r.currency),
        effectiveFrom:new Date(r.effective_from).toISOString(),
        effectiveTo:r.effective_to ? new Date(r.effective_to).toISOString() : null,
      }])),
      tests: new Map(tests.map(r=>[String(r.code).toUpperCase(),{id:String(r.id),status:String(r.status)}])),
      existing: new Map([[listId+"|"+testId, existing.map(r=>({
        effectiveFrom:new Date(r.effective_from).toISOString(),
        effectiveTo:r.effective_to ? new Date(r.effective_to).toISOString() : null,
      }))]]),
    };
    function candidate(row: mysql.RowDataPacket): PriceCandidate {
      return typeof row.normalized_data==="string" ? JSON.parse(row.normalized_data) : row.normalized_data;
    }
    assert.ok(reconcilePriceCandidate(candidate(first[1]),index,1).issues.includes("EXISTING_PRICE_WINDOW_COLLISION"));
    assert.ok(reconcilePriceCandidate(candidate(first[0]),index,2).issues.includes("OVERLAPPING_STAGED_PRICE_WINDOWS"));
    assert.equal(reconcilePriceCandidate(candidate(first[3]),index,1).disposition,"READY_FOR_GOVERNANCE");
    assert.equal(reconcilePriceCandidate(candidate(first[3]),index,1).currency,"AED");
    assert.ok(overlaps(candidate(first[0]).effectiveFrom,candidate(first[0]).effectiveTo,
      candidate(last[1]).effectiveFrom,candidate(last[1]).effectiveTo));
    assert.equal(reconcilePriceCandidate(candidate(first[0]),{
      ...index,lists:new Map(),tests:new Map(),
    },2).disposition,"BLOCKED");
  } finally {
    for(const row of cleanup) await writer.execute(`DELETE FROM ${row.table} WHERE id=?`,[row.id]);
    await Promise.all([writer.end(),reader.end()]);
  }
});
