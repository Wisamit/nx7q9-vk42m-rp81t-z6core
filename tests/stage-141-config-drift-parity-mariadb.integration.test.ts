import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogBundleDrift } from "../src/lib/catalog-bundle-drift.ts";

test("Stage 141 MariaDB: tenant-fenced container snapshot and tariff scope drift with concurrent master edit",{
  timeout: 90000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),timezone:"Z"};
  const [reader,writer]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),other=randomUUID(),branch=randomUUID(),
    container=randomUUID(),foreign=randomUUID(),tariff=randomUUID(),foreignTariff=randomUUID(),
    tag=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|null)[]){
    await reader.execute(sql,args);cleanup.unshift({table,id});
  }
  const query="SELECT id,code,name_en,name_ar,tube_color,additive,status,created_at,updated_at,deactivated_at "+
    "FROM containers WHERE organization_id=? AND id IN (?,?)";
  const record=(row:mysql.RowDataPacket)=>({
    id:row.id,code:row.code,nameEn:row.name_en,nameAr:row.name_ar,
    tubeColor:row.tube_color,additive:row.additive,status:row.status,
    createdAt:new Date(row.created_at).toISOString(),
    updatedAt:new Date(row.updated_at).toISOString(),
    deactivatedAt:row.deactivated_at?new Date(row.deactivated_at).toISOString():null,
  });
  try {
    for(const [id,key] of [[org,"A"],[other,"X"]]){
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S141"+tag+key,"Synthetic isolated lab"]);
    }
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S141"+tag,"Synthetic branch"]);
    for(const [id,tenant,key] of [[container,org,"A"],[foreign,other,"X"]]){
      await put("containers",id,
        "INSERT INTO containers(id,organization_id,code,name_en,name_ar,tube_color,additive,updated_at) "+
        "VALUES(?,?,?,?,?,'Purple','EDTA',NOW(3))",
        [id,tenant,"S141"+tag+key,"EDTA tube","أنبوب"]);
    }
    for(const [id,tenant,key,scope,scopeBranch] of [
      [tariff,org,"A","BRANCH",branch],
      [foreignTariff,other,"X","ORGANIZATION",null],
    ]) await put("price_lists",id!,
      "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,priority,effective_from,updated_at) "+
      "VALUES(?,?,?,?,?,?,'AED',1,'2026-01-01',NOW(3))",
      [id,tenant,"S141"+tag+key,"Synthetic tariff",scope,scopeBranch]);
    const tariffQuery="SELECT id,code,scope_type,branch_id,currency,source_id,referrer_id,client_id,contract_id,status "+
      "FROM price_lists WHERE organization_id=? AND (scope_type='ORGANIZATION' OR branch_id=?)";
    await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    const [initial]=await reader.execute<mysql.RowDataPacket[]>(query,[org,container,foreign]);
    assert.deepEqual(initial.map(v=>v.id),[container],"foreign tenant's container not available");
    const source=record(initial[0]);
    const [lists]=await reader.execute<mysql.RowDataPacket[]>(tariffQuery,[org,branch]);
    assert.deepEqual(lists.map(v=>v.id),[tariff],"foreign tenant's tariff not available");
    const finance={
      code:lists[0].code,scopeType:lists[0].scope_type,branchId:lists[0].branch_id,
      currency:lists[0].currency,sourceId:lists[0].source_id,
      referrerId:lists[0].referrer_id,clientId:lists[0].client_id,
      contractId:lists[0].contract_id,status:lists[0].status,
    };
    await writer.execute("UPDATE containers SET additive='Citrate',updated_at=NOW(3) WHERE id=?",[container]);
    await writer.execute("UPDATE price_lists SET currency='USD',updated_at=NOW(3) WHERE id=?",[tariff]);
    const [snapshot]=await reader.execute<mysql.RowDataPacket[]>(query,[org,container,foreign]);
    const [sameTariff]=await reader.execute<mysql.RowDataPacket[]>(tariffQuery,[org,branch]);
    assert.equal(catalogBundleDrift(source,record(snapshot[0])).disposition,"UNCHANGED",
      "same transaction snapshot stays consistent across concurrent edits");
    assert.equal(sameTariff[0].currency,finance.currency);
    await reader.commit();
    const [after]=await reader.execute<mysql.RowDataPacket[]>(query,[org,container,foreign]);
    const [currentTariff]=await reader.execute<mysql.RowDataPacket[]>(tariffQuery,[org,branch]);
    const drift=catalogBundleDrift(source,record(after[0]));
    assert.equal(drift.disposition,"DRIFTED");
    assert.ok(drift.changedFields.includes("additive"));
    const newer={...finance,currency:currentTariff[0].currency};
    assert.deepEqual(catalogBundleDrift(finance,newer).changedFields,["currency"]);
    const [notVisible]=await reader.execute<mysql.RowDataPacket[]>(query,[other,container,foreign]);
    assert.deepEqual(notVisible.map(v=>v.id),[foreign]);
  }finally{
    await reader.rollback().catch(()=>{});
    for(const {table,id} of cleanup) await reader.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([reader.end(),writer.end()]);
  }
});
