import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp,readFile,rm,stat } from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import mysql from "mysql2/promise";
import {exportF3TargetLineage} from "../scripts/legacy/export-target-lineage.mjs";
import {parseF3TargetLineageExport} from "../src/lib/f3-legacy-target-reconciliation.ts";

test("F3 MariaDB: export exactly one tenant/source under read-only snapshot into exclusive private file",{
  timeout:60000,
},async()=>{
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl)throw Error("DATABASE_URL required");
  const u=new URL(databaseUrl);
  const db=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1),
  });
  const org=randomUUID(),foreign=randomUUID();
  const rowA=randomUUID(),rowB=randomUUID(),otherRow=randomUUID();
  const sha="a".repeat(64),otherSha="e".repeat(64);
  const hmac="b".repeat(64),schema="c".repeat(64),digest="d".repeat(64);
  const key="F3"+org.slice(0,8);
  const tmp=await mkdtemp(join(tmpdir(),"f3-target-export-"));
  const target=join(tmp,"private-target.json");
  const execute=(sql:string,params:(string|number)[])=>db.execute(sql,params);
  try{
    for(const [id,label] of [[org,"A"],[foreign,"B"]]){
      await execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,key+label,"Synthetic F3 lab"]);
    }
    const insert="INSERT INTO legacy_catalog_row_lineage("+
      "id,organization_id,source_sha256,source_table,source_schema_sha256,"+
      "digest_key_id,row_digest,occurrence,classification,target_type,"+
      "target_id,revision,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3))";
    await execute(insert,[rowA,org,sha,"Test name",schema,hmac,digest,1,
      "MAPPED","TEST",randomUUID(),1,"test-actor"]);
    await execute(insert,[rowB,org,sha,"Test name",schema,hmac,digest,2,
      "UNRESOLVED","", "",0,"test-actor"].map((x,i)=>i===9||i===10?null:x) as string[]);
    await execute(insert,[otherRow,foreign,sha,"Test name",schema,hmac,digest,1,
      "MAPPED","TEST",randomUUID(),1,"test-actor"]);
    const result=await exportF3TargetLineage({
      databaseUrl,
      organizationId:org,sourceSha256:sha,outputPath:target,
    });
    assert.deepEqual(result,{exportedRows:2,privateFileCreated:true,
      operationalCertification:false});
    const data=parseF3TargetLineageExport(JSON.parse(await readFile(target,"utf8")));
    assert.equal(data.rows.length,2);
    assert.deepEqual(data.rows.map(r=>r.occurrence).sort(),[1,2]);
    assert.ok(data.rows.every(row=>row.sourceSha256===sha));
    assert.equal(data.organizationId,org);
    const file=await stat(target);
    if(process.platform!=="win32")assert.equal(file.mode&0o777,0o600);
    await assert.rejects(()=>exportF3TargetLineage({
      databaseUrl,
      organizationId:org,sourceSha256:sha,outputPath:target,
    }),/EEXIST/,"private output must not be overwritten");
    assert.equal(parseF3TargetLineageExport(JSON.parse(
      await readFile(target,"utf8"))).rows.length,2);
    const separate=join(tmp,"unrelated-source.json");
    const empty=await exportF3TargetLineage({
      databaseUrl,
      organizationId:org,sourceSha256:otherSha,outputPath:separate,
    });
    assert.equal(empty.exportedRows,0);
  }finally{
    await execute("DELETE FROM legacy_catalog_row_lineage WHERE id IN (?,?,?)",
      [rowA,rowB,otherRow]).catch(()=>{});
    await execute("DELETE FROM organizations WHERE id IN (?,?)",
      [org,foreign]).catch(()=>{});
    await db.end();
    await rm(tmp,{recursive:true,force:true});
  }
});
