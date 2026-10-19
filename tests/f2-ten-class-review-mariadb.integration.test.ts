import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { bundleTriageClass, catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { summarizeCatalogGovernance } from "../src/lib/catalog-governance-readiness.ts";

test("F2 MariaDB: ten staged review classes survive tenant-locked reading without any master activation",
{timeout: 45000}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1)};
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org=randomUUID(), foreignOrg=randomUUID(), author=randomUUID(), batch=randomUUID();
  const prefix="F2D"+org.slice(0,8), checksum="a".repeat(64);
  const rowIds=[...catalogExportTypes].map(()=>randomUUID());
  const run=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
  try {
    await run("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,prefix+"A","F2 review test tenant"]);
    await run("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [foreignOrg,prefix+"B","F2 foreign test tenant"]);
    await run("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [author,org,prefix+"U","F2 reviewer"]);
    await run("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','synthetic-f2.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,author]);
    let number=0;
    for (const entityType of catalogExportTypes) {
      number++;
      const source={id:randomUUID(),entityType,note:"synthetic no-PHI source"};
      await run("INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,?,?,'WARNING',?,?,NOW(3))",
        [rowIds[number-1],batch,number,entityType,JSON.stringify(source),JSON.stringify(source)]);
    }
    await reader.execute("SET SESSION innodb_lock_wait_timeout=8");
    await reader.beginTransaction();
    const [tenant] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(tenant.length,1);
    const [staged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT r.row_number,r.entity_type,r.status,r.imported_entity_id,b.status AS batch_status FROM catalog_import_rows r JOIN catalog_import_batches b ON b.id=r.batch_id WHERE b.organization_id=? AND b.id=? ORDER BY r.row_number",
      [org,batch]);
    assert.equal(staged.length,10);
    for(const row of staged) {
      assert.equal(row.status,"WARNING");
      assert.equal(row.imported_entity_id,null);
      assert.equal(row.batch_status,"DRAFT");
      assert.ok(bundleTriageClass(String(row.entity_type)));
      assert.match(catalogDriftObservationToken(
        "test-only-f2-strong-signing-key-for-observation",checksum,Number(row.row_number),
        String(row.entity_type),{source:"review"},{live:"different"}),/^[a-f0-9]{64}$/);
    }
    const governance=summarizeCatalogGovernance(staged.map(row=>({
      entityType:String(row.entity_type),disposition:"DRIFTED" as const,
      finding:{status:"UNFLAGGED" as const},
    })),true);
    assert.equal(governance.byCategory.CROSS_DOMAIN.total,2);
    assert.equal(governance.byCategory.FINANCIAL.total,3);
    assert.equal(governance.byCategory.CLINICAL.total,5);
    assert.equal(governance.activationAllowed,false);
    assert.equal(governance.liveWrites,false);
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT b.id FROM catalog_import_batches b WHERE b.organization_id=? AND b.id=?",[foreignOrg,batch]);
    assert.equal(foreign.length,0);
    await reader.commit();
    const [unchanged]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM catalog_import_rows WHERE batch_id=? AND status='WARNING' AND imported_entity_id IS NULL",[batch]);
    assert.equal(Number(unchanged[0].total),10);
  } finally {
    await reader.rollback().catch(()=>{});
    await run("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await run("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await run("DELETE FROM users WHERE id=?",[author]).catch(()=>{});
    await run("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
