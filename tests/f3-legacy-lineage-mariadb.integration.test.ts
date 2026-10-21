import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {prisma} from "../src/lib/db.ts";
import {LEGACY_COVERAGE_SOURCES}
  from "../src/lib/legacy-source-coverage.ts";
import {buildF3LegacyExtractionManifest}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {f3LiveLineageTargetsVisible}
  from "../src/lib/f3-legacy-target-visibility.ts";
import {reconcileF3LegacySource}
  from "../src/lib/f3-legacy-source-reconciliation.ts";

test("F3 MariaDB: 15-table offline HMAC rows reconcile against real tenant ledger and fail on foreign/stale target",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const sql=await mysql.createConnection(config);
  const org=randomUUID(),foreign=randomUUID(),testId=randomUUID(),
    otherTest=randomUUID(),eventId=randomUUID(),otherEvent=randomUUID();
  const sourceSha256="a".repeat(64),digestKeyId="b".repeat(64);
  const secret="synthetic-f3-mariadb-lineage-signing-key-not-production-123";
  const marker="F3"+org.slice(0,8);
  const manifest=buildF3LegacyExtractionManifest({
    organizationId:org,sourceSha256,digestKeyId,
    tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>({
      name:tableName,
      columns:[{name:"label",accessType:"ACE_TYPE_202"}],
      rows:tableName==="test"?[{label:"Synthetic analyzer definition"}]:[],
    })),
  },secret);
  const proof=manifest.rows.find(x=>x.sourceTable==="test")!;
  const query=(sqlText:string,params:Array<string|number>)=>
    sql.execute(sqlText,params);
  async function reconcile(){
    return prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
      assert.equal(locked.length,1);
      const rows=await tx.legacyCatalogRowLineage.findMany({
        where:{organizationId:org,sourceSha256,digestKeyId},
        select:{organizationId:true,sourceSha256:true,digestKeyId:true,
          sourceTable:true,sourceSchemaSha256:true,rowDigest:true,
          occurrence:true,classification:true,targetType:true,targetId:true},
      });
      const visible=await f3LiveLineageTargetsVisible(tx,{
        organizationId:org,lineage:rows,
        currentOrganizationScopeVerified:true,
      });
      return {visible,report:visible?reconcileF3LegacySource({
        manifest,lineage:rows,tenantAndTargetScopeVerified:true,
      }):null};
    },{isolationLevel:"RepeatableRead",timeout:30000});
  }
  try{
    for(const [id,suffix] of [[org,"A"],[foreign,"B"]])
      await query("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,marker+suffix,"F3 Synthetic Org"]);
    for(const [id,owner,suffix] of [[testId,org,"A"],[otherTest,foreign,"B"]])
      await query("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,owner,marker+suffix,"F3 Synthetic Test"]);
    const insert="INSERT INTO legacy_catalog_row_lineage("+
      "id,organization_id,source_sha256,source_table,source_schema_sha256,"+
      "digest_key_id,row_digest,occurrence,classification,target_type,target_id,"+
      "created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,? ,NOW(3))";
    for(const [id,owner,target] of [[eventId,org,testId],[otherEvent,foreign,otherTest]])
      await query(insert,[id,owner,sourceSha256,proof.sourceTable,
        proof.sourceSchemaSha256,digestKeyId,proof.rowDigest,proof.occurrence,
        "MAPPED","TEST",target,"synthetic-f3-reviewer"]);
    const first=await reconcile();
    assert.equal(first.visible,true);
    assert.equal(first.report?.sourceRows,1);
    assert.equal(first.report?.matchedRows,1);
    assert.equal(first.report?.missingRows,0);
    assert.equal(first.report?.syntheticFullyClassified,true);
    assert.equal(first.report?.originalMdbProven,false);
    assert.equal(first.report?.qualifiedMappingApproved,false);
    // Moving a mapped target to a foreign tenant is denied even when the
    // de-identified evidence row itself still belongs to the valid org.
    await query("UPDATE legacy_catalog_row_lineage SET target_id=?,updated_at=NOW(3) WHERE id=?",
      [otherTest,eventId]);
    const moved=await reconcile();
    assert.equal(moved.visible,false);
    assert.equal(moved.report,null);
    await query("UPDATE legacy_catalog_row_lineage SET target_id=?,updated_at=NOW(3) WHERE id=?",
      [testId,eventId]);
    await query("DELETE FROM legacy_catalog_row_lineage WHERE id=?",[eventId]);
    const missing=await reconcile();
    assert.equal(missing.visible,true);
    assert.equal(missing.report?.missingRows,1);
    assert.equal(missing.report?.syntheticFullyClassified,false);
    const [original]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(original[0].count),1,
      "legacy source reconciliation never writes clinical catalog masters");
  }finally{
    await query("DELETE FROM legacy_catalog_row_lineage WHERE id IN (?,?)",
      [eventId,otherEvent]).catch(()=>{});
    await query("DELETE FROM lab_tests WHERE id IN (?,?)",
      [testId,otherTest]).catch(()=>{});
    await query("DELETE FROM organizations WHERE id IN (?,?)",
      [org,foreign]).catch(()=>{});
    await sql.end();
    await prisma.$disconnect();
  }
});
