import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {LEGACY_COVERAGE_SOURCES,LEGACY_COVERAGE_TYPE} from "../src/lib/legacy-source-coverage.ts";
import {LEGACY_ROW_LINEAGE_TYPE} from "../src/lib/catalog-legacy-row-lineage.ts";
import {reconcileF3LegacyRowParity} from "../src/lib/legacy-f3-row-parity.ts";
const H=(n:number)=>n.toString(16).padStart(64,"0");
test("F3 MariaDB: actual persisted source occurrence must match private 15-table evidence",async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const db=await mysql.createConnection({
    host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1),
  });
  const org=randomUUID(),key=randomUUID(),author=randomUUID();
  const source={sourceName:"synthetic.mdb",sourceSha256:H(70),sourceBytes:8192};
  const page={schemaVersion:1 as const,evidenceType:LEGACY_ROW_LINEAGE_TYPE,
    ...source,tableName:"Test name",schemaSha256:H(71),digestKeyId:H(72),
    sourceRowCount:1,chunkIndex:0,chunkCount:1,
    exportedAtUtc:"2026-10-21T12:00:00Z",includesPatientData:false as const,
    rows:[{rowDigest:H(73),occurrence:1}]};
  const coverage={schemaVersion:1 as const,evidenceType:LEGACY_COVERAGE_TYPE,
    ...source,exportedAtUtc:page.exportedAtUtc,includesPatientData:false as const,
    tables:LEGACY_COVERAGE_SOURCES.map(x=>({
      tableName:x.tableName,present:x.tableName===page.tableName,
      rowCount:x.tableName===page.tableName?1:0,
      columnCount:x.tableName===page.tableName?2:0,
      schemaSha256:x.tableName===page.tableName?page.schemaSha256:null,
    }))};
  const query=async()=>{
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT source_sha256 sourceSha256,source_table sourceTable,source_schema_sha256 sourceSchemaSha256,digest_key_id digestKeyId,row_digest rowDigest,occurrence,revision,classification,target_type targetType,target_id targetId,created_by_user_id createdByUserId,mapped_by_user_id mappedByUserId,reviewed_by_user_id reviewedByUserId,reviewed_at reviewedAt FROM legacy_catalog_row_lineage WHERE organization_id=?",
      [org]);
    return reconcileF3LegacyRowParity({source,coverage,lineage:[page],persisted:rows});
  };
  try{
    await db.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"F3"+org.slice(0,8),"Synthetic F3"]);
    await db.execute("INSERT INTO legacy_catalog_row_lineage(id,organization_id,source_sha256,source_table,source_schema_sha256,digest_key_id,row_digest,occurrence,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,NOW(3))",
      [key,org,source.sourceSha256,page.tableName,page.schemaSha256,
        page.digestKeyId,page.rows[0].rowDigest,1,author]);
    assert.equal((await query()).missingRows,0);
    await db.execute("DELETE FROM legacy_catalog_row_lineage WHERE id=?",[key]);
    assert.equal((await query()).missingRows,1);
  }finally{
    await db.execute("DELETE FROM legacy_catalog_row_lineage WHERE organization_id=?",[org]).catch(()=>{});
    await db.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await db.end();
  }
});
