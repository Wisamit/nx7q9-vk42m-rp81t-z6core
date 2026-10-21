import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {LEGACY_COVERAGE_SOURCES}
  from "../src/lib/legacy-source-coverage.ts";
import {buildF3LegacyExtractionManifest}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {f3LiveLineageTargetsVisible}
  from "../src/lib/f3-legacy-target-visibility.ts";
import {reconcileF3LegacySource,type F3LineageDecision}
  from "../src/lib/f3-legacy-source-reconciliation.ts";

/**
 * Exercise real MariaDB tenant isolation without importing the Next.js
 * Prisma runtime into Node's TS-strip test runner. The narrowly mocked
 * Prisma surface executes ACTUAL SQL in the already-locked transaction.
 */
test("F3 MariaDB: 15-table HMAC source reconciles the tenant's persisted ledger, rejects cross-tenant target",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const db=await mysql.createConnection(config);
  const org=randomUUID(),foreign=randomUUID(),testId=randomUUID(),
    otherTest=randomUUID(),eventId=randomUUID(),otherEvent=randomUUID(),
    authorId=randomUUID(),foreignAuthorId=randomUUID();
  const sourceSha256="a".repeat(64),digestKeyId="b".repeat(64);
  const secret="synthetic-f3-mariadb-lineage-signing-key-not-production-123";
  const marker="F3"+org.slice(0,8);
  const manifest=buildF3LegacyExtractionManifest({
    organizationId:org,sourceSha256,digestKeyId,
    tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>({
      name:tableName,columns:[{name:"label",accessType:"ACE_TYPE_202"}],
      rows:tableName==="Test name"?[{label:"Synthetic analyzer definition"}]:[],
    })),
  },secret);
  const proof=manifest.rows.find(x=>x.sourceTable==="Test name")!;
  const query=(text:string,params:Array<string|number>)=>db.execute(text,params);
  async function reconcile(){
    await db.beginTransaction();
    try{
      const [locked]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
      assert.equal(locked.length,1);
      const [sourceRows]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT organization_id AS organizationId,source_sha256 AS sourceSha256,"+
        "digest_key_id AS digestKeyId,source_table AS sourceTable,"+
        "source_schema_sha256 AS sourceSchemaSha256,row_digest AS rowDigest,"+
        "occurrence,classification,target_type AS targetType,target_id AS targetId "+
        "FROM legacy_catalog_row_lineage WHERE organization_id=? AND source_sha256=? AND digest_key_id=?",
        [org,sourceSha256,digestKeyId]);
      const lineage=sourceRows.map(row=>({
        organizationId:String(row.organizationId),sourceSha256:String(row.sourceSha256),
        digestKeyId:String(row.digestKeyId),sourceTable:String(row.sourceTable),
        sourceSchemaSha256:String(row.sourceSchemaSha256),rowDigest:String(row.rowDigest),
        occurrence:Number(row.occurrence),classification:row.classification,
        targetType:row.targetType,targetId:row.targetId,
      })) as F3LineageDecision[];
      const scopeTx={
        labTest:{findMany:async({where}:{where:{id:{in:string[]};organizationId:string}})=>{
          const wanted=where.id.in;
          const [items]=await db.query<mysql.RowDataPacket[]>(
            "SELECT id FROM lab_tests WHERE organization_id=? AND id IN ("+
            wanted.map(()=>"?").join(",")+")",[where.organizationId,...wanted]);
          return items.map(item=>({id:String(item.id)}));
        }},
      };
      const visible=await f3LiveLineageTargetsVisible(scopeTx as never,{
        organizationId:org,lineage,currentOrganizationScopeVerified:true,
      });
      const report=visible?reconcileF3LegacySource({
        manifest,lineage,tenantAndTargetScopeVerified:true,
      }):null;
      await db.commit();
      return {visible,report};
    }catch(error){await db.rollback();throw error;}
  }
  try{
    for(const [id,suffix] of [[org,"A"],[foreign,"B"]])
      await query("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,marker+suffix,"F3 Synthetic Org"]);
    for(const [id,tenant,suffix] of [[authorId,org,"A"],[foreignAuthorId,foreign,"B"]])
      await query("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,tenant,marker+"U"+suffix,"F3 Synthetic Operator"]);
    for(const [id,owner,suffix] of [[testId,org,"A"],[otherTest,foreign,"B"]])
      await query("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,owner,marker+"T"+suffix,"F3 Synthetic Test"]);
    const insert="INSERT INTO legacy_catalog_row_lineage("+
      "id,organization_id,source_sha256,source_table,source_schema_sha256,"+
      "digest_key_id,row_digest,occurrence,classification,target_type,target_id,"+
      "created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))";
    for(const [id,owner,target,userId] of [
      [eventId,org,testId,authorId],[otherEvent,foreign,otherTest,foreignAuthorId],
    ])await query(insert,[id,owner,sourceSha256,proof.sourceTable,
      proof.sourceSchemaSha256,digestKeyId,proof.rowDigest,proof.occurrence,
      "MAPPED","TEST",target,userId]);
    const first=await reconcile();
    assert.equal(first.visible,true);
    assert.equal(first.report?.sourceRows,1);
    assert.equal(first.report?.matchedRows,1);
    assert.equal(first.report?.missingRows,0);
    assert.equal(first.report?.syntheticFullyClassified,true);
    assert.equal(first.report?.originalMdbProven,false);
    assert.equal(first.report?.qualifiedMappingApproved,false);
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
    const [original]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(original[0].count),1,"reconciliation never writes masters");
  }finally{
    await query("DELETE FROM legacy_catalog_row_lineage WHERE id IN (?,?)",
      [eventId,otherEvent]).catch(()=>{});
    await query("DELETE FROM lab_tests WHERE id IN (?,?)",
      [testId,otherTest]).catch(()=>{});
    await query("DELETE FROM users WHERE id IN (?,?)",
      [authorId,foreignAuthorId]).catch(()=>{});
    await query("DELETE FROM organizations WHERE id IN (?,?)",
      [org,foreign]).catch(()=>{});
    await db.end();
  }
});
