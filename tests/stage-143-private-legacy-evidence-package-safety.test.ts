import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm, unlink } from "node:fs/promises";
import {
  LEGACY_COVERAGE_SOURCES, LEGACY_COVERAGE_TYPE, parseLegacySourceCoverage,
} from "../src/lib/legacy-source-coverage.ts";
import {
  LEGACY_ROW_LINEAGE_TYPE, parseLegacyRowManifest,
} from "../src/lib/catalog-legacy-row-lineage.ts";
import {
  LegacyEvidencePackageError, verifyLegacyEvidenceManifestPackage,
} from "../src/lib/legacy-evidence-package-review.ts";
import { execFileSync } from "node:child_process";

const schemaHash="a".repeat(64), keyId="b".repeat(64),
  repeatedHash="c".repeat(64), priceHash="d".repeat(64), when="2026-10-15T12:00:00.000Z";
const mdbName="synthetic-test.mdb";

function fixtures() {
  const file=Buffer.alloc(8192);
  file.write("Standard Jet DB",4,"ascii");
  const source={
    sourceName:mdbName,sourceBytes:file.length,
    sourceSha256:createHash("sha256").update(file).digest("hex"),
  };
  const coverage={
    schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,...source,
    exportedAtUtc:when,includesPatientData:false,
    tables:LEGACY_COVERAGE_SOURCES.map(spec=>{
      const present=["Test name","price"].includes(spec.tableName);
      const rowCount=spec.tableName==="Test name"?501:spec.tableName==="price"?2:0;
      return {tableName:spec.tableName,present,rowCount,
        columnCount:present?2:0,schemaSha256:present?schemaHash:null};
    }),
  };
  function page(tableName: string, rows: Array<{rowDigest: string; occurrence: number}>, index: number, chunks: number, count: number) {
    return {
      schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
      tableName,schemaSha256:schemaHash,digestKeyId:keyId,sourceRowCount:count,
      chunkIndex:index,chunkCount:chunks,exportedAtUtc:when,
      includesPatientData:false,rows,
    };
  }
  const identifiers=Array.from({length:501},(_,i)=>({rowDigest:repeatedHash,occurrence:i+1}));
  const pages=[
    page("Test name",identifiers.slice(0,500),0,2,501),
    page("Test name",identifiers.slice(500),1,2,501),
    page("price",[{rowDigest:priceHash,occurrence:1},
      {rowDigest:priceHash,occurrence:2}],0,1,2),
  ];
  return {file,source,coverage,pages};
}
function verify(fixture: ReturnType<typeof fixtures>) {
  return verifyLegacyEvidenceManifestPackage({
    source:fixture.source,
    coverage:parseLegacySourceCoverage(fixture.coverage),
    lineage:fixture.pages.map(parseLegacyRowManifest),
  });
}
function denied(work: () => unknown, code: string) {
  assert.throws(work,(err)=>err instanceof LegacyEvidencePackageError&&err.code===code,code);
}

test("Stage143: multi-page duplicates, 15 table inventory, no PHI and explicit non-approval",()=>{
  const f=fixtures();
  const review=verify(f);
  assert.equal(review.masterRows,503);
  assert.equal(review.tables.length,15);
  assert.equal(review.tables.find(t=>t.tableName==="Test name")?.checkedPages,2);
  assert.equal(review.tables.find(t=>t.tableName==="price")?.sourceRows,2);
  assert.equal(review.status,"METADATA_CONSISTENT_REVIEW_ONLY");
  assert.equal(review.sourceHmacIndependentlyVerified,false);
  assert.equal(review.targetMappingCertified,false);
  assert.equal(review.clinicalApproved,false);
  assert.equal(review.financialApproved,false);
  assert.equal(review.cutoverApproved,false);
  assert.doesNotMatch(JSON.stringify(review),/patient|password|raw_values/i);
});

test("Stage143: reject exchanged MDB, missing/duplicate pages, source schema, HMAC key and count mismatch",()=>{
  const f=fixtures();
  denied(()=>verify({...f,source:{...f.source,sourceSha256:"f".repeat(64)}}),
    "legacy_evidence_source_mismatch");
  denied(()=>verify({...f,pages:f.pages.slice(1)}),"legacy_evidence_missing_or_extra_page");
  denied(()=>verify({...f,pages:[...f.pages,f.pages[0]]}),"legacy_evidence_duplicate_chunk");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===2?{...p,sourceSha256:"e".repeat(64)}:p)}),
    "legacy_evidence_cross_source_page");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===1?{...p,schemaSha256:"e".repeat(64)}:p)}),
    "legacy_evidence_page_schema_or_index_mismatch");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===2?{...p,digestKeyId:"e".repeat(64)}:p)}),
    "legacy_evidence_key_changed");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===1?{...p,sourceRowCount:502}:p)}),
    "legacy_evidence_page_schema_or_index_mismatch");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===0?{...p,rows:p.rows.slice(1)}:p)}),
    "legacy_evidence_page_not_complete");
});

test("Stage143: reject reordered digests, duplicate occurrence gap and data hidden as metadata",()=>{
  const f=fixtures();
  const alternate="0".repeat(64);
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===0?{...p,rows:[
    {rowDigest:alternate,occurrence:1},...p.rows.slice(1)]}:p)}),
    "legacy_evidence_digest_sort_order");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===0?{...p,rows:[
    p.rows[0],{rowDigest:alternate,occurrence:1},...p.rows.slice(2)]}:p)}),
    "legacy_evidence_digest_sort_order");
  denied(()=>verify({...f,pages:f.pages.map((p,i)=>i===1?{...p,rows:[
    {rowDigest:repeatedHash,occurrence:503}]}:p)}),
    "legacy_evidence_duplicate_occurrence_gap");
  assert.throws(()=>parseLegacyRowManifest({...f.pages[0],patientId:"raw_identifier"}));
  assert.throws(()=>parseLegacySourceCoverage({...f.coverage,notes:"extracted patient data"}));
});

test("Stage143: real local file hash and header anchor; stale or unexpected source/page rejected",async()=>{
  const d=await mkdtemp(join(tmpdir(),"family-lab-legacy-evidence-test-"));
  const mdb=join(d,mdbName), coverage=join(d,"coverage.json"),
    lineage=join(d,"private-pages");
  const f=fixtures();
  try {
    await mkdir(lineage);
    await writeFile(mdb,f.file);
    await writeFile(coverage,JSON.stringify(f.coverage));
    for (const page of f.pages) {
      const name="legacy-row-hashes-"+page.tableName.replace(/[^A-Za-z0-9]/g,"_")+
        "-"+String(page.chunkIndex).padStart(5,"0")+".json";
      await writeFile(join(lineage,name),JSON.stringify(page));
    }
    const run=()=>JSON.parse(execFileSync(process.execPath,[
      "--experimental-strip-types","scripts/legacy/verify-evidence-package.mjs",
      "--mdb",mdb,"--coverage",coverage,"--lineage-dir",lineage,
    ],{encoding:"utf8"}));
    const review=run();
    assert.equal(review.localMdbBytesHashMatched,true);
    assert.equal(review.sourceRowsIndependentlyRecomputedFromMdb,false);
    assert.equal(review.masterRows,503);
    await writeFile(join(lineage,"surprise-patient.json"),"{}");
    assert.throws(run,/unexpected_evidence_page_name/);
    await unlink(join(lineage,"surprise-patient.json"));
    const modified=Buffer.from(f.file);modified[100]=1;
    await writeFile(mdb,modified);
    assert.throws(run,/legacy_evidence_source_mismatch/);
  } finally { await rm(d,{recursive:true,force:true}); }
});
