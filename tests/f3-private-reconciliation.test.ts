import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
// @ts-ignore - The private Node .mjs tool is validated by this runtime test.
import {checkPrivateF3Lineage} from "../scripts/legacy/reconcile-source-ledger.mjs";
import {LEGACY_COVERAGE_TYPE,LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
import {LEGACY_ROW_LINEAGE_TYPE} from "../src/lib/catalog-legacy-row-lineage.ts";
const sha=(x:number)=>x.toString(16).padStart(64,"0");
test("F3 private runner: synthetic Jet source to 15-table ledger, fail closed on altered row or extra fields",async()=>{
  const root=await mkdtemp(join(tmpdir(),"family-f3-synthetic-"));
  try{
    const dir=join(root,"pages");await mkdir(dir);
    const bytes=Buffer.alloc(8192);
    Buffer.from("Standard Jet DB").copy(bytes,4);
    const source={sourceName:"synthetic.mdb",sourceBytes:bytes.length,
      sourceSha256:createHash("sha256").update(bytes).digest("hex")};
    const p=join(root,source.sourceName);
    await writeFile(p,bytes);
    const coverage={schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,...source,
      exportedAtUtc:"2026-10-21T12:00:00Z",includesPatientData:false,
      tables:LEGACY_COVERAGE_SOURCES.map(t=>({
        tableName:t.tableName,present:t.tableName==="Test name",
        rowCount:t.tableName==="Test name"?1:0,
        columnCount:t.tableName==="Test name"?2:0,
        schemaSha256:t.tableName==="Test name"?sha(2):null,
      }))};
    const page={schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
      tableName:"Test name",schemaSha256:sha(2),digestKeyId:sha(3),
      sourceRowCount:1,chunkIndex:0,chunkCount:1,
      exportedAtUtc:coverage.exportedAtUtc,includesPatientData:false,
      rows:[{rowDigest:sha(4),occurrence:1}]};
    const ledger=[{sourceSha256:source.sourceSha256,sourceTable:"Test name",
      sourceSchemaSha256:sha(2),digestKeyId:sha(3),rowDigest:sha(4),
      occurrence:1,revision:0,classification:"UNRESOLVED",
      targetType:null,targetId:null,createdByUserId:
        "00000000-0000-4000-8000-000000000040",
      mappedByUserId:null,reviewedByUserId:null,reviewedAt:null}];
    const coveragePath=join(root,"coverage.json"),ledgerPath=join(root,"ledger.json");
    await writeFile(coveragePath,JSON.stringify(coverage));
    await writeFile(join(dir,"legacy-row-hashes-Test_name-00000.json"),JSON.stringify(page));
    await writeFile(ledgerPath,JSON.stringify(ledger));
    const good=await checkPrivateF3Lineage(p,coveragePath,dir,ledgerPath);
    assert.equal(good.sourceTables,15);assert.equal(good.persistedRows,1);
    assert.equal(good.unresolvedRows,1);assert.equal(good.cutoverApproved,false);
    await writeFile(ledgerPath,JSON.stringify([{...ledger[0],privatePatientName:"NO"}]));
    await assert.rejects(()=>checkPrivateF3Lineage(p,coveragePath,dir,ledgerPath));
    await writeFile(ledgerPath,JSON.stringify(ledger));
    await writeFile(p,Buffer.alloc(8192));
    await assert.rejects(()=>checkPrivateF3Lineage(p,coveragePath,dir,ledgerPath));
  }finally{await rm(root,{recursive:true,force:true});}
});
