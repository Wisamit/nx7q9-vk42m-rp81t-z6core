import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { stagedPriceOverlapIndex } from "../src/lib/price-import-reconciliation.ts";

test("MariaDB independent sessions: scoped staged pricing collisions cross pages and never post financial rows",
  { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host:url.hostname, port:Number(url.port || 3306), user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password), database:url.pathname.slice(1) };
  const [writer,reader] = await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(), foreignOrg=randomUUID(), actor=randomUUID(), foreignActor=randomUUID();
  const batch=randomUUID(), foreignBatch=randomUUID(), suffix=org.slice(0,8);
  const execute=(sql:string,params: Array<string|number>)=>writer.execute(sql,params);
  const price=(from:string,to:string,testCode="HGB")=>({
    priceListCode:"ST38",testCode,unitPrice:"1200.1234",effectiveFrom:from,effectiveTo:to,
  });
  const insert=async(id:string,num:number,status:string,source:ReturnType<typeof price>)=>{
    const json=JSON.stringify(source);
    await execute("INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'PRICE_LIST_ITEM',?,?,?,NOW(3))",
      [randomUUID(),id,num,status,json,json]);
  };
  try {
    for (const [id,code] of [[org,"A"],[foreignOrg,"B"]]) {
      await execute("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"ST38-"+suffix+code,"Price Review"]);
    }
    for (const [id,tenant,code] of [[actor,org,"A"],[foreignActor,foreignOrg,"B"]]) {
      await execute("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"st38-"+suffix+code,"Price Reviewer"]);
    }
    for (const [id,tenant,owner] of [[batch,org,actor],[foreignBatch,foreignOrg,foreignActor]]) {
      await execute("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','prices.csv','DRAFT',?,NOW(3))",
        [id,tenant,owner]);
    }
    await insert(batch,1,"WARNING",price("2026-10-01","2026-10-31"));
    for(let i=2;i<=100;i++) await insert(batch,i,"WARNING",price("2026-10-01","2026-10-31","OTHER-"+i));
    await insert(batch,101,"WARNING",price("2026-10-31","2026-11-30"));
    await insert(batch,102,"ERROR",price("2026-09-01","2027-01-01","ISOLATED-ERROR"));
    await insert(batch,103,"IMPORTED",price("2026-09-01","2027-01-01","ISOLATED-ERROR"));
    await insert(batch,104,"SKIPPED",price("2026-09-01","2027-01-01","ISOLATED-ERROR"));
    await insert(foreignBatch,1,"WARNING",price("2026-01-01","2027-01-01"));

    const [owned]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=?",[batch,org]);
    const [denied]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=?",[batch,foreignOrg]);
    assert.equal(owned.length,1);
    assert.equal(denied.length,0);

    const [first]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT `row_number` AS rowNumber FROM catalog_import_rows WHERE batch_id=? AND entity_type='PRICE_LIST_ITEM' AND `row_number`>0 ORDER BY `row_number`,id LIMIT 101",[batch]);
    assert.equal(first.length,101);
    assert.equal(Number(first[99].rowNumber),100);
    const [second]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT `row_number` AS rowNumber FROM catalog_import_rows WHERE batch_id=? AND entity_type='PRICE_LIST_ITEM' AND `row_number`>? ORDER BY `row_number`,id LIMIT 101",[batch,100]);
    assert.deepEqual(second.map(row=>Number(row.rowNumber)),[101,102,103,104]);
    const [eligible]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT `row_number` AS rowNumber,status,normalized_data AS normalizedData FROM catalog_import_rows WHERE batch_id=? AND entity_type='PRICE_LIST_ITEM' AND status IN ('VALID','WARNING') LIMIT 20001",[batch]);
    const rows=eligible.map(row=>({rowNumber:Number(row.rowNumber),status:String(row.status),
      normalizedData:typeof row.normalizedData==="string" ? JSON.parse(row.normalizedData) : row.normalizedData}));
    assert.equal(rows.length,101);
    const collisions=stagedPriceOverlapIndex(rows);
    assert.deepEqual([...collisions].sort((a,b)=>a-b),[1,101]);
    assert.equal(stagedPriceOverlapIndex(rows.slice(0,100)).has(1),false);
    const [untouched]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT status,COUNT(*) AS qty FROM catalog_import_rows WHERE batch_id=? GROUP BY status",[batch]);
    assert.deepEqual(Object.fromEntries(untouched.map(row=>[String(row.status),Number(row.qty)])),
      {WARNING:101,ERROR:1,IMPORTED:1,SKIPPED:1});
  } finally {
    await execute("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await execute("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await execute("DELETE FROM users WHERE id IN (?,?)",[actor,foreignActor]).catch(()=>{});
    await execute("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
