import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp,mkdir,rm,writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { LEGACY_COVERAGE_SOURCES,LEGACY_COVERAGE_TYPE } from "../src/lib/legacy-source-coverage.ts";
import { LEGACY_ROW_LINEAGE_TYPE } from "../src/lib/catalog-legacy-row-lineage.ts";
import { F3_TARGET_LINEAGE_TYPE } from "../src/lib/f3-legacy-target-reconciliation.ts";

const hash=(letter:string)=>letter.repeat(64);
const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const org=id(1),date="2026-10-21T00:00:00.000Z",schema=hash("b"),key=hash("c");
test("F3 private CLI: real synthetic Jet bytes + 15-table manifests + target parity; sanitize raw IDs and status",{
  timeout:30000,
},async()=>{
  const dir=await mkdtemp(join(tmpdir(),"f3-reconciliation-"));
  try{
    const file=Buffer.alloc(8192);
    file.write("Standard Jet DB",4,"ascii");
    const source={sourceName:"synthetic-parity.mdb",sourceSha256:
      createHash("sha256").update(file).digest("hex"),sourceBytes:file.length};
    const mdb=join(dir,source.sourceName),coverageFile=join(dir,"coverage.json"),
      lineageDir=join(dir,"lineage"),targetFile=join(dir,"target.json");
    await mkdir(lineageDir);
    await writeFile(mdb,file);
    const coverage={
      schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,...source,
      exportedAtUtc:date,includesPatientData:false,
      tables:LEGACY_COVERAGE_SOURCES.map(t=>({
        tableName:t.tableName,present:t.tableName==="Test name",
        rowCount:t.tableName==="Test name"?2:0,
        columnCount:t.tableName==="Test name"?3:0,
        schemaSha256:t.tableName==="Test name"?schema:null,
      })),
    };
    await writeFile(coverageFile,JSON.stringify(coverage));
    const page={
      schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
      tableName:"Test name",schemaSha256:schema,digestKeyId:key,
      sourceRowCount:2,chunkIndex:0,chunkCount:1,
      exportedAtUtc:date,includesPatientData:false,
      rows:[{rowDigest:hash("d"),occurrence:1},
        {rowDigest:hash("d"),occurrence:2}],
    };
    await writeFile(join(lineageDir,"legacy-row-hashes-Test_name-00000.json"),
      JSON.stringify(page));
    const rows=page.rows.map((entry,i)=>({
      sourceTable:"Test name",sourceSha256:source.sourceSha256,
      sourceSchemaSha256:schema,digestKeyId:key,
      ...entry,classification:"APPROVED_MAPPING",
      targetType:"TEST",targetId:id(i+30),batchId:null,importRowId:null,
      revision:1,
    }));
    const payload={schemaVersion:1,evidenceType:F3_TARGET_LINEAGE_TYPE,
      organizationId:org,sourceSha256:source.sourceSha256,rows};
    const run=()=>spawnSync(process.execPath,[
      "--experimental-strip-types","scripts/legacy/verify-target-reconciliation.mjs",
      "--mdb",mdb,"--coverage",coverageFile,"--lineage-dir",lineageDir,
      "--target-export",targetFile,"--organization",org,
    ],{encoding:"utf8",timeout:20000});
    await writeFile(targetFile,JSON.stringify(payload));
    const success=run();
    assert.equal(success.status,0,success.stderr);
    const report=JSON.parse(success.stdout);
    assert.equal(report.sourceRows,2);
    assert.equal(report.approvedMapping,2);
    assert.equal(report.state,"ROW_KEYS_MATCH_REVIEW_ONLY");
    assert.equal(report.sourceRowsIndependentlyRecomputedFromMdb,false);
    assert.equal(report.targetMappingCertified,false);
    for(const forbidden of [hash("d"),id(30),org,source.sourceSha256]){
      assert.equal(success.stdout.includes(forbidden),false,
        "CLI must redact source SHA, organization and individual row identifiers");
    }
    await writeFile(targetFile,JSON.stringify({...payload,rows:rows.slice(0,1)}));
    const incomplete=run();
    assert.equal(incomplete.status,3);
    assert.equal(JSON.parse(incomplete.stdout).absentFromTarget,1);
    await writeFile(targetFile,JSON.stringify({...payload,rows:[
      {...rows[0],sourceSchemaSha256:hash("f")},rows[1],
    ]}));
    const tampered=run();
    assert.equal(tampered.status,1);
    assert.match(tampered.stderr,/private source\/target evidence invalid/);
    assert.equal(tampered.stderr.includes(hash("f")),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
