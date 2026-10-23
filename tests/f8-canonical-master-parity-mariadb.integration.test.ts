import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { canonicalStagingCsvFromAtomicGroup } from "../src/lib/catalog-canonical-review-spreadsheet.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { normalizeImportRow } from "../src/lib/catalog-import.ts";

test("F8 MariaDB: bilingual tube/additive and UCUM survive a tenant-consistent review projection",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1),timezone:"Z"};
  const [reader,writer]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),containerId=randomUUID(),
    unitId=randomUUID(),foreignContainerId=randomUUID(),tag=org.slice(0,8).toUpperCase();
  const inserted:Array<{table:string;id:string}>=[];
  async function insert(table:string,id:string,sql:string,args:(string|null)[]){
    await writer.execute(sql,args);inserted.unshift({table,id});
  }
  const names={tube:"أنبوب بنفسجي",unit:"ملغ لكل ديسيلتر"};
  try{
    for(const [id,suffix] of [[org,"A"],[foreignOrg,"F"]]){
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"CF8"+tag+suffix,"Synthetic Catalog Lab"]);
    }
    await insert("containers",containerId,
      "INSERT INTO containers(id,organization_id,code,name_en,name_ar,tube_color,additive,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,NOW(3))",
      [containerId,org,"TUBE"+tag,"EDTA tube",names.tube,"Purple","K2 EDTA"]);
    await insert("containers",foreignContainerId,
      "INSERT INTO containers(id,organization_id,code,name_en,name_ar,tube_color,additive,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,NOW(3))",
      [foreignContainerId,foreignOrg,"F"+tag,"Foreign tube","أنبوب","Red","No"]);
    await insert("units",unitId,
      "INSERT INTO units(id,organization_id,code,symbol,name_en,name_ar,ucum_code,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,NOW(3))",
      [unitId,org,"MGDL"+tag,"mg/dL","Milligrams per deciliter",names.unit,"mg/dL"]);
    await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    const [containers]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en,name_ar,tube_color,additive,status FROM containers "+
      "WHERE organization_id=? ORDER BY id",[org]);
    const [units]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,symbol,name_en,name_ar,ucum_code,status FROM units "+
      "WHERE organization_id=? ORDER BY id",[org]);
    assert.deepEqual(containers.map(x=>x.id),[containerId]);
    assert.deepEqual(units.map(x=>x.id),[unitId]);
    await writer.execute("UPDATE containers SET tube_color='Blue',additive='Citrate',updated_at=NOW(3) WHERE id=?",
      [containerId]);
    await writer.execute("UPDATE units SET ucum_code='g/L',updated_at=NOW(3) WHERE id=?",
      [unitId]);
    const [stillContainers]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en,name_ar,tube_color,additive,status FROM containers "+
      "WHERE organization_id=?",[org]);
    const [stillUnits]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,symbol,name_en,name_ar,ucum_code,status FROM units "+
      "WHERE organization_id=?",[org]);
    assert.equal(stillContainers[0].additive,"K2 EDTA");
    assert.equal(stillUnits[0].ucum_code,"mg/dL");
    const tubeSource=stillContainers.map(x=>({id:x.id,code:x.code,nameEn:x.name_en,
      nameAr:x.name_ar,tubeColor:x.tube_color,additive:x.additive,status:x.status}));
    const unitSource=stillUnits.map(x=>({id:x.id,code:x.code,nameEn:x.name_en,
      nameAr:x.name_ar,symbol:x.symbol,ucumCode:x.ucum_code,status:x.status}));
    const tubeCsv=canonicalStagingCsvFromAtomicGroup({entityType:"CONTAINER",records:tubeSource});
    const unitCsv=canonicalStagingCsvFromAtomicGroup({entityType:"UNIT",records:unitSource});
    const [tube]=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(tubeCsv)));
    const [unit]=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(unitCsv)));
    assert.equal(tube.legacyKey,containerId);
    assert.equal(unit.legacyKey,unitId);
    assert.deepEqual(normalizeImportRow(tube),{code:"TUBE"+tag.toUpperCase(),
      nameEn:"EDTA tube",nameAr:names.tube,tubeColor:"Purple",additive:"K2 EDTA"});
    assert.equal(normalizeImportRow(unit).ucumCode,"mg/dL");
    assert.equal(normalizeImportRow(unit).nameAr,names.unit);
    await reader.commit();
    const [updated]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT tube_color,additive FROM containers WHERE id=?",[containerId]);
    assert.equal(updated[0].additive,"Citrate");
  }finally{
    await reader.rollback().catch(()=>{});
    for(const entry of inserted){
      await writer.execute("DELETE FROM "+entry.table+" WHERE id=?",[entry.id]).catch(()=>{});
    }
    await Promise.all([reader.end(),writer.end()]);
  }
});
