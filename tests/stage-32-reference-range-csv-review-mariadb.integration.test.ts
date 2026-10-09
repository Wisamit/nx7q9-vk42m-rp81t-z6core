import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { validateRangeCsvReview } from "../src/lib/catalog-range-csv-review.ts";
import { normalizeImportRow, validateImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";

test("MariaDB two sessions: CSV reference ranges remain review-only, exact, atomic and tenant-isolated", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL), cfg={
    host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),
  };
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreign=randomUUID(),actor=randomUUID(),other=randomUUID(),batch=randomUUID();
  const row1=randomUUID(),row2=randomUUID(),suffix=org.slice(0,8);
  const insert=async(q:string,a: Array<string|number|null>)=>writer.execute(q,a);
  const csv=["entityType,legacyKey,testName,unit,sex,ageFrom,ageTo,ageUnit,low,high,normalTextEn",
    'REFERENCE_INTERVAL,R-001,Free T4,pmol/L,FEMALE,12.000,70.000,YEAR,-1.250001,28.125000,"سليم, طبيعي"',
    "REFERENCE_INTERVAL,R-002,Glucose,mmol/L,ANY,0.000,120.000,YEAR,5.000001,4.999999,"].join("\r\n");
  const inputs=parseCsvReviewFile(csv);
  try {
    for(const [id,code] of [[org,"OWN"],[foreign,"OTHER"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"RR32-"+code+suffix,"Range Review Organization"]);
    }
    for(const [id,tenant,key] of [[actor,org,"A"],[other,foreign,"B"]]){
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"rr32-"+key+suffix,"Range Reviewer"]);
    }
    await writer.beginTransaction();
    await insert("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','range.csv','DRAFT',?,NOW(3))",
      [batch,org,actor]);
    for(let i=0;i<inputs.length;i++){
      const normalized=normalizeImportRow(inputs[i]);
      const issues=[...validateImportRow(inputs[i].entityType,normalized),...validateRangeCsvReview(inputs[i])];
      const status=rowValidationStatus(issues);
      assert.equal(status,i===0?"WARNING":"ERROR");
      await insert("INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,legacy_key,status,source_data,normalized_data,validation_issues,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
        [i===0?row1:row2,batch,i+1,inputs[i].entityType,inputs[i].legacyKey||null,status,
          JSON.stringify(inputs[i].data),JSON.stringify(normalized),JSON.stringify(issues)]);
    }
    const q="SELECT r.entity_type,r.status,r.source_data,r.normalized_data,r.validation_issues,b.source_type,b.status AS batch_status FROM catalog_import_rows r JOIN catalog_import_batches b ON b.id=r.batch_id WHERE b.organization_id=? AND b.id=? ORDER BY r.`row_number`";
    const [before]=await reader.execute<mysql.RowDataPacket[]>(q,[org,batch]);
    assert.equal(before.length,0,"uncommitted range source must not be visible");
    await writer.commit();
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(q,[org,batch]);
    assert.equal(rows.length,2);
    assert.ok(rows.every(r=>r.entity_type==="REFERENCE_INTERVAL" && r.source_type==="CSV_REVIEW" && r.batch_status==="DRAFT"));
    assert.deepEqual(rows.map(r=>r.status),["WARNING","ERROR"]);
    const data=(r:unknown)=>typeof r==="string" ? JSON.parse(r) : r;
    const first=data(rows[0].normalized_data);
    assert.equal(first.low,"-1.250001");
    assert.equal(first.high,"28.125000");
    assert.equal(first.ageFrom,"12.000");
    assert.equal(first.normalTextEn,"سليم, طبيعي");
    const errors=data(rows[1].validation_issues);
    assert.ok(errors.some((x:{code:string})=>x.code==="RANGE_REVIEW_REVERSED_LIMITS"));
    const [foreignRows]=await reader.execute<mysql.RowDataPacket[]>(q,[foreign,batch]);
    assert.equal(foreignRows.length,0);
    const [clinical]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM reference_intervals ri JOIN test_components tc ON tc.id=ri.component_id JOIN lab_tests t ON t.id=tc.test_id WHERE t.organization_id=?",[org]);
    assert.equal(Number(clinical[0].n),0,"CSV staging cannot touch live reference intervals");
  } finally {
    await writer.rollback().catch(()=>{});
    await insert("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await insert("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await insert("DELETE FROM users WHERE id IN (?,?)",[actor,other]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
