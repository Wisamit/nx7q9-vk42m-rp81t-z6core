import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 138 MariaDB: container tenant isolation, coherent snapshot and price-list branch scope",{
  timeout: 90000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [reader,writer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),other=randomUUID(),branchA=randomUUID(),branchB=randomUUID(),
    containerA=randomUUID(),containerOther=randomUUID(),
    listOrg=randomUUID(),listB=randomUUID(),listOther=randomUUID();
  const tag=org.slice(0,8);
  const created:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|null)[]){
    await reader.execute(sql,args); created.unshift({table,id});
  }
  try{
    for(const [id,code] of [[org,"A"],[other,"F"]])
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S138"+tag+code,"Synthetic Review Lab"]);
    for(const [id,code] of [[branchA,"A"],[branchB,"B"]])
      await put("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S138"+tag+code,"Synthetic Branch"]);
    for(const [id,tenant,code] of [[containerA,org,"A"],[containerOther,other,"F"]])
      await put("containers",id,
        "INSERT INTO containers(id,organization_id,code,name_en,name_ar,tube_color,additive,updated_at) "+
        "VALUES(?,?,?,?,?,?,?,NOW(3))",
        [id,tenant,"S138"+tag+code,"Tube source","أنبوب","Purple","EDTA"]);
    for(const [id,tenant,code,scope,branch] of [
      [listOrg,org,"ORG","ORGANIZATION",null],
      [listB,org,"B","BRANCH",branchB],
      [listOther,other,"F","ORGANIZATION",null],
    ]) await put("price_lists",id!,
      "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) "+
      "VALUES(?,?,?,?,?,?,'AED','2026-01-01',NOW(3))",
      [id,tenant,"S138"+tag+code,"Synthetic Tariff",scope,branch]);
    const [scoped]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_ar,tube_color,additive FROM containers WHERE organization_id=? ORDER BY id",[org]);
    assert.deepEqual(scoped.map(row=>row.id),[containerA]);
    assert.equal(scoped[0].name_ar,"أنبوب");
    assert.equal(scoped[0].additive,"EDTA");
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM containers WHERE organization_id=? AND id=?",[org,containerOther]);
    assert.equal(foreign.length,0,"foreign container identity cannot be reviewed in a tenant");
    const [branchOnly]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,currency FROM price_lists WHERE organization_id=? "+
      "AND ((scope_type='ORGANIZATION' AND branch_id IS NULL) "+
      "OR (scope_type='BRANCH' AND branch_id=?)) ORDER BY id",[org,branchA]);
    assert.deepEqual(branchOnly.map(row=>row.id),[listOrg]);
    assert.equal(branchOnly[0].currency,"AED");
    const [branchBoth]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_lists WHERE organization_id=? "+
      "AND ((scope_type='ORGANIZATION' AND branch_id IS NULL) "+
      "OR (scope_type='BRANCH' AND branch_id=?)) ORDER BY id",[org,branchB]);
    assert.deepEqual(new Set(branchBoth.map(row=>row.id)),new Set([listOrg,listB]));
    await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    const [before]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT additive FROM containers WHERE id=? AND organization_id=?",[containerA,org]);
    await writer.execute("UPDATE containers SET additive=?,updated_at=NOW(3) WHERE id=?",
      ["Citrate",containerA]);
    const [sameSnapshot]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT additive FROM containers WHERE id=? AND organization_id=?",[containerA,org]);
    assert.equal(before[0].additive,"EDTA");
    assert.equal(sameSnapshot[0].additive,"EDTA","signed bundle consistent read cannot mix source revisions");
    await reader.commit();
    const [current]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT additive FROM containers WHERE id=? AND organization_id=?",[containerA,org]);
    assert.equal(current[0].additive,"Citrate","subsequent bundle review must detect changed additive");
  }finally{
    await reader.rollback().catch(()=>{});
    for(const row of created) await reader.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([reader.end(),writer.end()]);
  }
});
