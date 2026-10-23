import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { canonicalStagingCsvFromAtomicGroup } from "../src/lib/catalog-canonical-review-spreadsheet.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { normalizeImportRow } from "../src/lib/catalog-import.ts";

test("Stage 140 MariaDB: actual price master branch/tenant scoped DRAFT projection stays snapshot-consistent under a second writer",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),timezone:"Z"};
  const [reader,writer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    priceId=randomUUID(),foreignPriceId=randomUUID(),tag=org.slice(0,8).toUpperCase();
  const cleanup:Array<{table:string;id:string}>=[];
  async function insert(table:string,id:string,sql:string,values:(string|null)[]){
    await reader.execute(sql,values);cleanup.unshift({table,id});
  }
  try{
    for(const [id,key] of [[org,"O"],[foreignOrg,"F"]]){
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S140"+tag+key,"Synthetic review lab"]);
    }
    await insert("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S140"+tag,"Synthetic authorized branch"]);
    for(const [id,tenant,key,scope,branchId] of [
      [priceId,org,"B","BRANCH",branch],
      [foreignPriceId,foreignOrg,"F","ORGANIZATION",null],
    ]){
      await insert("price_lists",id!,
        "INSERT INTO price_lists(id,organization_id,code,name_en,name_ar,scope_type,branch_id,currency,priority,effective_from,updated_at) "+
        "VALUES(?,?,?,?,?,?,?,'AED',7,'2026-01-01',NOW(3))",
        [id,tenant,"S140"+tag+key,"Review source","مصدر مراجعة",scope,branchId]);
    }
    const query="SELECT id,code,name_en,name_ar,scope_type,branch_id,currency,priority,effective_from,effective_to,status,"+
      "source_id,referrer_id,client_id,contract_id FROM price_lists WHERE organization_id=? "+
      "AND (scope_type='ORGANIZATION' AND branch_id IS NULL OR scope_type='BRANCH' AND branch_id=?) ORDER BY id";
    await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    const [before]=await reader.execute<mysql.RowDataPacket[]>(query,[org,branch]);
    assert.deepEqual(before.map(r=>r.id),[priceId],"another tenant's tariff cannot be projected");
    await writer.execute("UPDATE price_lists SET priority=99,updated_at=NOW(3) WHERE id=?",[priceId]);
    const [consistent]=await reader.execute<mysql.RowDataPacket[]>(query,[org,branch]);
    assert.equal(consistent[0].priority,7,"transactional signed export uses one consistent source snapshot");
    const projected=consistent.map(row=>({
      id:row.id,code:row.code,nameEn:row.name_en,nameAr:row.name_ar,status:row.status,
      scopeType:row.scope_type,branchId:row.branch_id,currency:row.currency,priority:row.priority,
      effectiveFrom:new Date(row.effective_from).toISOString(),
      effectiveTo:row.effective_to?new Date(row.effective_to).toISOString():null,
      sourceId:row.source_id,referrerId:row.referrer_id,clientId:row.client_id,contractId:row.contract_id,
    }));
    const csv=canonicalStagingCsvFromAtomicGroup({entityType:"PRICE_LIST",records:projected});
    const staged=parseCsvReviewFile(csv);
    assert.equal(staged.length,1);
    assert.equal(staged[0].legacyKey,priceId);
    const normalized=normalizeImportRow(staged[0]);
    assert.equal(normalized.priority,"7");
    assert.equal(normalized.branchId,branch);
    assert.equal(normalized.currency,"AED");
    assert.equal(normalized.effectiveFrom,"2026-01-01");
    await reader.commit();
    const [after]=await reader.execute<mysql.RowDataPacket[]>(query,[org,branch]);
    assert.equal(after[0].priority,99,"a fresh export sees the new tariff, not historical source snapshot");
    const [outside]=await reader.execute<mysql.RowDataPacket[]>(query,[foreignOrg,branch]);
    assert.equal(outside.length,1);
    assert.equal(outside[0].id,foreignPriceId,"foreign tenant has a separate source context");
  }finally{
    await reader.rollback().catch(()=>{});
    for(const item of cleanup) await reader.execute("DELETE FROM "+item.table+" WHERE id=?",[item.id]).catch(()=>{});
    await Promise.all([reader.end(),writer.end()]);
  }
});
