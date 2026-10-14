import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  LEGACY_COVERAGE_SOURCES,LEGACY_COVERAGE_TYPE,
  parseLegacySourceCoverage,compareLegacyCoverage,
} from "../src/lib/legacy-source-coverage.ts";

test("Stage 118 MariaDB: author/tenant/source constrained counts never certify another operator",
  {timeout:90000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const u=new URL(process.env.DATABASE_URL),cfg={
      host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
      password:decodeURIComponent(u.password),database:u.pathname.slice(1),
    };
    const [db,otherConn]=await Promise.all([
      mysql.createConnection(cfg),mysql.createConnection(cfg),
    ]);
    const org=randomUUID(),otherOrg=randomUUID(),user=randomUUID(),otherUser=randomUUID();
    const ownBatch=randomUUID(),someoneBatch=randomUUID(),foreignBatch=randomUUID(),wrongName=randomUUID();
    const rows=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    const suffix=org.slice(0,8),cleanup:Array<{table:string;id:string}>=[];
    async function add(table:string,id:string,sql:string,args:Array<string|number|null>){
      await db.execute(sql,args);cleanup.unshift({table,id});
    }
    try{
      for(const [id,code]of [[org,"A"],[otherOrg,"B"]])await add("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S118"+suffix+code,"Synthetic origin"]);
      for(const [id,code,owner]of [[user,"A",org],[otherUser,"B",otherOrg]])await add("users",id,
        "INSERT INTO users(id,organization_id,username,email,password_hash,display_name_en,status,updated_at) VALUES(?,?,?,?,?,?,'ACTIVE',NOW(3))",
        [id,owner,"stage118"+suffix+code,"stage118"+suffix+code+"@example.test","never-a-login-hash","Synthetic operator"]);
      const sourceName="Family lab -test.mdb";
      for(const [id,owner,author,name]of [
        [ownBatch,org,user,sourceName],[someoneBatch,org,otherUser,sourceName],
        [foreignBatch,otherOrg,otherUser,sourceName],[wrongName,org,user,"different.mdb"],
      ]){
        await add("catalog_import_batches",id,
          "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
          [id,owner,"LEGACY_MDB_EXPORT",name,"VALIDATED",author]);
      }
      const sql="INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,updated_at) VALUES(?,?,?,?,?,'{}',NOW(3))";
      for(const [index,batch,type,status]of [
        [0,ownBatch,"TEST","IMPORTED"],[1,ownBatch,"PANEL","WARNING"],
        [2,someoneBatch,"TEST","IMPORTED"],[3,foreignBatch,"TEST","IMPORTED"],
      ] as const){
        await add("catalog_import_rows",rows[index],sql,
          [rows[index],batch,index+1,type,status]);
      }
      const query="SELECT id FROM catalog_import_batches WHERE organization_id=? "+
        "AND created_by_user_id=? AND source_type='LEGACY_MDB_EXPORT' AND source_name=?";
      const [allowed]=await db.execute<mysql.RowDataPacket[]>(query,[org,user,sourceName]);
      assert.deepEqual(allowed.map(x=>x.id),[ownBatch]);
      const [scoped]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT entity_type,status,COUNT(*) AS total FROM catalog_import_rows "+
        "WHERE batch_id=? GROUP BY entity_type,status ORDER BY entity_type",
        [ownBatch]);
      assert.equal(scoped.length,2);
      assert.equal(scoped.find(x=>x.entity_type==="TEST")?.total,1);
      const manifest=parseLegacySourceCoverage({
        schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,
        sourceName,sourceSha256:"a".repeat(64),sourceBytes:150585344,
        exportedAtUtc:"2026-10-14T10:00:00.000Z",includesPatientData:false,
        tables:LEGACY_COVERAGE_SOURCES.map(spec=>({
          tableName:spec.tableName,present:true,rowCount:spec.target==="TEST"?2:1,
          columnCount:4,schemaSha256:"b".repeat(64),
        })),
      });
      const coverage=compareLegacyCoverage(manifest,
        scoped.map(x=>({entityType:String(x.entity_type),status:String(x.status),count:Number(x.total)})),1);
      assert.equal(coverage.find(x=>x.tableName==="Test name")?.finding,
        "SOURCE_COUNT_EXCEEDS_STAGING_CANDIDATES");
      assert.equal(coverage.find(x=>x.tableName==="profile")?.stagedUnresolved,1);
      assert.equal(coverage.find(x=>x.tableName==="price")?.stagedCandidates,0);
      assert.ok(coverage.every(x=>x.verified===false));

      // Separate MariaDB connection cannot observe uncommitted adjustments.
      await db.beginTransaction();
      await db.execute(
        "UPDATE catalog_import_rows SET status='IMPORTED' WHERE id=?",
        [rows[1]]);
      const [before]=await otherConn.execute<mysql.RowDataPacket[]>(
        "SELECT status FROM catalog_import_rows WHERE id=?",[rows[1]]);
      assert.equal(before[0].status,"WARNING");
      await db.rollback();
      const [after]=await otherConn.execute<mysql.RowDataPacket[]>(
        "SELECT status FROM catalog_import_rows WHERE id=?",[rows[1]]);
      assert.equal(after[0].status,"WARNING");
    }finally{
      await db.rollback().catch(()=>{});
      for(const x of cleanup)await db.execute("DELETE FROM "+x.table+" WHERE id=?",[x.id]).catch(()=>{});
      await Promise.all([db.end(),otherConn.end()]);
    }
  });
