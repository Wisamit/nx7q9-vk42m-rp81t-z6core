import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_COVERAGE_TYPE, LEGACY_COVERAGE_SOURCES, parseLegacySourceCoverage } from "../src/lib/legacy-source-coverage.ts";
import { LEGACY_ROW_LINEAGE_TYPE, parseLegacyRowManifest } from "../src/lib/catalog-legacy-row-lineage.ts";
import { LegacyEvidencePackageError, verifyLegacyEvidenceManifestPackage } from "../src/lib/legacy-evidence-package-review.ts";

const schema="a".repeat(64), digest="b".repeat(64), other="c".repeat(64), key="d".repeat(64);
function fixture() {
  const file=Buffer.alloc(8192);file.write("Standard Jet DB",4,"ascii");
  const source={sourceName:"synthetic-replay.mdb",sourceBytes:file.length,
    sourceSha256:createHash("sha256").update(file).digest("hex")};
  const coverage={schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,...source,
    exportedAtUtc:"2026-10-16T08:00:00.000Z",includesPatientData:false,
    tables:LEGACY_COVERAGE_SOURCES.map(t=>({
      tableName:t.tableName,present:t.tableName==="Test name",
      rowCount:t.tableName==="Test name"?501:0,
      columnCount:t.tableName==="Test name"?2:0,
      schemaSha256:t.tableName==="Test name"?schema:null,
    }))};
  const rows=Array.from({length:501},(_,i)=>({
    rowDigest:i<300?digest:other,occurrence:i<300?i+1:i-299,
  }));
  const page=(index:number,subset:typeof rows)=>({
    schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
    tableName:"Test name",schemaSha256:schema,digestKeyId:key,sourceRowCount:501,
    chunkIndex:index,chunkCount:2,exportedAtUtc:"2026-10-16T08:00:00.000Z",
    includesPatientData:false,rows:subset,
  });
  return {file,source,coverage,pages:[page(0,rows.slice(0,500)),page(1,rows.slice(500))]};
}
function check(f:ReturnType<typeof fixture>,replay=structuredClone(f.pages)){
  return verifyLegacyEvidenceManifestPackage({source:f.source,
    coverage:parseLegacySourceCoverage(f.coverage),
    lineage:f.pages.map(parseLegacyRowManifest),
    replayedLineage:replay.map(parseLegacyRowManifest)});
}
function rejected(fn:()=>unknown,code:string){
  assert.throws(fn,error=>error instanceof LegacyEvidencePackageError&&error.code===code);
}
test("Stage144: identical fresh row HMAC pages pass but never certify clinical, finance or target mapping",()=>{
  const f=fixture(),r=check(f);
  assert.equal(r.masterRows,501);
  assert.equal(r.status,"ACE_HMAC_REPLAY_MATCHED_REVIEW_ONLY");
  assert.equal(r.sourceHmacAceReplayMatches,true);
  assert.equal(r.sourceHmacIndependentlyVerified,false);
  assert.equal(r.clinicalApproved,false);
  assert.equal(r.financialApproved,false);
  assert.equal(r.targetMappingCertified,false);
  assert.equal(r.cutoverApproved,false);
  assert.doesNotMatch(JSON.stringify(r),new RegExp(digest));
});
test("Stage144: full page and each digest compared; reject forged valid-looking HMACs",()=>{
  const f=fixture(),fake=structuredClone(f.pages);
  for(const p of fake)for(const row of p.rows)if(row.rowDigest===digest)row.rowDigest=schema;
  rejected(()=>check(f,fake),"legacy_replay_row_hmac_mismatch");
  const badKey=structuredClone(f.pages);badKey.forEach(p=>{p.digestKeyId=schema;});
  rejected(()=>check(f,badKey),"legacy_replay_page_metadata_mismatch");
  const broken=structuredClone(f.pages);broken[1].rows[0].occurrence=202;
  rejected(()=>check(f,broken),"legacy_evidence_duplicate_occurrence_gap");
  rejected(()=>check(f,[f.pages[0]]),"legacy_evidence_missing_or_extra_page");
  rejected(()=>check(f,[...f.pages,f.pages[0]]),"legacy_evidence_duplicate_chunk");
});
test("Stage144: actual offline CLI compares all rows and sanitizes mismatch errors",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"stage144-"));
  const f=fixture(),mdb=join(dir,f.source.sourceName),coverage=join(dir,"coverage.json"),
    sourceDir=join(dir,"original"),freshDir=join(dir,"fresh");
  try{
    await mkdir(sourceDir);await mkdir(freshDir);
    await writeFile(mdb,f.file);await writeFile(coverage,JSON.stringify(f.coverage));
    for(const page of f.pages){
      const name="legacy-row-hashes-Test_name-"+String(page.chunkIndex).padStart(5,"0")+".json";
      await writeFile(join(sourceDir,name),JSON.stringify(page));
      await writeFile(join(freshDir,name),JSON.stringify(page));
    }
    const run=()=>spawnSync(process.execPath,[
      "--experimental-strip-types","scripts/legacy/verify-evidence-package.mjs",
      "--mdb",mdb,"--coverage",coverage,"--lineage-dir",sourceDir,
      "--ace-replay-dir",freshDir],{encoding:"utf8",timeout:20000});
    const ok=run();assert.equal(ok.status,0,ok.stderr);
    const result=JSON.parse(ok.stdout);
    assert.equal(result.sameExtractorAceReplayMatched,true);
    assert.equal(result.sourceRowsIndependentlyRecomputedFromMdb,false);
    const fake=structuredClone(f.pages[0]);
    fake.rows.forEach(row=>{if(row.rowDigest===digest)row.rowDigest=schema;});
    await writeFile(join(freshDir,"legacy-row-hashes-Test_name-00000.json"),JSON.stringify(fake));
    const bad=run();
    assert.equal(bad.status,1);
    assert.match(bad.stderr,/legacy_replay_row_hmac_mismatch/);
    assert.ok(!bad.stderr.includes(digest)&&!bad.stderr.includes(schema));
    assert.ok(!bad.stderr.includes(dir));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("Stage144: Windows wrapper always cleans private scratch replay and demands ACE extractor",()=>{
  const s=readFileSync("scripts/legacy/verify-access-row-replay.ps1","utf8");
  assert.match(s,/export-row-lineage\.ps1/);
  assert.match(s,/-HmacKeyFile \$key -OutputDirectory \$replay/);
  assert.match(s,/--ace-replay-dir \$replay/);
  assert.match(s,/NewGuid\(\)/);
  assert.match(s,/finally \{/);
  assert.match(s,/Remove-Item -LiteralPath \$replay -Force -Recurse/);
  assert.match(s,/SAME-EXTRACTOR REPLAY ONLY/);
});
