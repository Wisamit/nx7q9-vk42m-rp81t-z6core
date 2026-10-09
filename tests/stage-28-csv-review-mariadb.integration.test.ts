import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "../src/lib/catalog-import.ts";

test("MariaDB two sessions: CSV evidence remains DRAFT, isolated by tenant and invisible until atomic commit", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const cfg = { host: u.hostname, port: Number(u.port || 3306),
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), foreign = randomUUID(), actor = randomUUID(), foreignActor = randomUUID();
  const batch = randomUUID(), foreignBatch = randomUUID(), suffix = org.slice(0, 8);
  const stagedIds: string[] = [];
  const csv = [
    "entityType,legacyKey,testCode,code,nameEn,unitCode,resultType,priceListCode,unitPrice,effectiveFrom",
    'COMPONENT,C-1,TEST28,GLU,"Glucose, fasting",MGDL,NUMERIC,,,',
    "PRICE_LIST_ITEM,P-1,TEST28,,,,,BASE_AED,123.4500,2026-10-09",
  ].join("\r\n");
  const inputs = parseCsvReviewFile(csv);
  const insert = async (sql: string, args: Array<string | number | null>) => writer.execute(sql, args);
  const read = async (tenant: string) => {
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT r.id,r.entity_type,r.status,r.source_data,r.normalized_data,b.status AS batch_status,b.source_type FROM catalog_import_rows r JOIN catalog_import_batches b ON b.id=r.batch_id WHERE b.organization_id=? AND b.id=? ORDER BY r.row_number",
      [tenant, batch]);
    return rows;
  };
  try {
    for (const [id,k] of [[org,"A"],[foreign,"B"]])
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"CSV28-"+k+suffix,"CSV Stage Organization"]);
    for (const [id,owner,k] of [[actor,org,"A"],[foreignActor,foreign,"B"]])
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"csv28-"+k+suffix,"CSV Stage Actor"]);
    await insert("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','components-prices.csv','DRAFT',?,NOW(3))",
      [foreignBatch,foreign,foreignActor]);

    await writer.beginTransaction();
    await insert("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','components-prices.csv','DRAFT',?,NOW(3))",
      [batch,org,actor]);
    for (let i=0;i<inputs.length;i++) {
      const row=inputs[i], id=randomUUID(), normalized=normalizeImportRow(row);
      const issues=validateImportRow(row.entityType,normalized);
      const status=rowValidationStatus(issues);
      assert.equal(status,"WARNING");
      stagedIds.push(id);
      await insert(
        "INSERT INTO catalog_import_rows (id,batch_id,row_number,entity_type,legacy_key,status,source_data,normalized_data,validation_issues,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
        [id,batch,i+1,row.entityType,row.legacyKey||null,status,JSON.stringify(row.data),JSON.stringify(normalized),JSON.stringify(issues)],
      );
    }
    assert.equal((await read(org)).length, 0, "uncommitted clinical/financial candidates must not leak to another connection");
    await writer.commit();
    const visible=await read(org);
    assert.equal(visible.length, 2);
    assert.ok(visible.every(row=>row.batch_status==="DRAFT" && row.source_type==="CSV_REVIEW" && row.status==="WARNING"));
    assert.equal((await read(foreign)).length, 0);
    const price=visible.find(row=>row.entity_type==="PRICE_LIST_ITEM");
    assert.ok(price);
    const sourcePrice=typeof price.source_data==="string" ? JSON.parse(price.source_data) : price.source_data;
    assert.equal(sourcePrice.unitPrice,"123.4500");
    const component=visible.find(row=>row.entity_type==="COMPONENT");
    const componentSource=typeof component.source_data==="string" ? JSON.parse(component.source_data) : component.source_data;
    assert.equal(componentSource.nameEn,"Glucose, fasting");

    const [live]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM test_components WHERE code=?) AS component_count, (SELECT COUNT(*) FROM price_list_items WHERE id IN (?,?)) AS price_count",
      ["CSV28-"+suffix,...stagedIds]);
    assert.equal(Number(live[0].component_count),0);
    assert.equal(Number(live[0].price_count),0);
  } finally {
    await writer.rollback().catch(()=>{});
    await insert("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await insert("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await insert("DELETE FROM users WHERE id IN (?,?)",[actor,foreignActor]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
