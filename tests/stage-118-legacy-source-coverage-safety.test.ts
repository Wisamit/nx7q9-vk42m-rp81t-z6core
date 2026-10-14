import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_COVERAGE_SOURCES, LEGACY_COVERAGE_TYPE, parseLegacySourceCoverage,
  sourceCoverageFingerprint, compareLegacyCoverage,
} from "../src/lib/legacy-source-coverage.ts";

const hash="a".repeat(64);
const manifest=()=>({
  schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,
  sourceName:"Family lab -test.mdb",sourceSha256:hash,
  sourceBytes:150585344,exportedAtUtc:"2026-10-14T10:00:00.000Z",
  includesPatientData:false,
  tables:LEGACY_COVERAGE_SOURCES.map(spec=>({
    tableName:spec.tableName,present:true,rowCount:10,
    columnCount:4,schemaSha256:"b".repeat(64),
  })),
});
test("Stage 118: fixed deidentified 15-table manifest is complete and fingerprinted",()=>{
  const parsed=parseLegacySourceCoverage(manifest());
  assert.equal(parsed.tables.length,15);
  assert.equal(parsed.sourceSha256,hash);
  assert.equal(sourceCoverageFingerprint(parsed).length,64);
  assert.equal(parsed.tables.some(x=>/^(ID|result|cbc|culture)$/i.test(x.tableName)),false);
  assert.equal(new Set(parsed.tables.map(x=>x.tableName.toLowerCase())).size,15);
});
test("Stage 118: forbid unknown, repeated, missing and inconsistent source metadata",()=>{
  const bad=manifest();
  assert.throws(()=>parseLegacySourceCoverage({...bad,tables:[...bad.tables,{...bad.tables[0]}]}),/invalid_legacy_source_manifest/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,tables:bad.tables.slice(1)}),/invalid_legacy_source_manifest/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,
    tables:bad.tables.map((x,i)=>i===0?{...x,tableName:"ID"}:x)}),
    /unexpected_or_duplicate_legacy_source_table/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,
    tables:bad.tables.map((x,i)=>i===0?{...x,present:false}:x)}),
    /invalid_legacy_source_table_evidence/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,includesPatientData:true}),
    /invalid_legacy_source_manifest/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,sourceName:"/tmp/source.mdb"}),
    /invalid_legacy_source_manifest/);
  assert.throws(()=>parseLegacySourceCoverage({...bad,sourceBytes:0}),
    /invalid_legacy_source_manifest/);
});
test("Stage 118: source candidate counts are never interpreted as row identity proof",()=>{
  const parsed=parseLegacySourceCoverage(manifest());
  const findings=compareLegacyCoverage(parsed,[
    {entityType:"TEST",status:"IMPORTED",count:10},
    {entityType:"PANEL",status:"WARNING",count:3},
    {entityType:"PANEL",status:"SKIPPED",count:2},
    {entityType:"REFERENCE_INTERVAL",status:"VALID",count:10},
    {entityType:"PRICE_LIST_ITEM",status:"IMPORTED",count:10},
    {entityType:"UNIT",status:"IMPORTED",count:10},
    {entityType:"CONTAINER",status:"IMPORTED",count:20},
  ],1);
  assert.equal(findings.find(x=>x.tableName==="Test name")?.finding,"COUNT_MATCH_NOT_ROW_PROOF");
  assert.equal(findings.find(x=>x.tableName==="profile")?.finding,"SOURCE_COUNT_EXCEEDS_STAGING_CANDIDATES");
  assert.equal(findings.find(x=>x.tableName==="Tube")?.finding,"COUNT_MATCH_NOT_ROW_PROOF");
  assert.equal(findings.find(x=>x.tableName==="Comment")?.finding,"DIRECT_IMPORT_REQUIRES_PROVENANCE");
  assert.equal(findings.find(x=>x.tableName==="test")?.finding,"MANUAL_MAPPING_REQUIRED");
  assert.ok(findings.every(x=>!x.verified&&!x.clinicalApproved&&!x.financialApproved));
  assert.equal(compareLegacyCoverage(parsed,[],0).find(x=>x.tableName==="profile")?.finding,
    "NO_LINKED_STAGING_BATCHES");
});
test("Stage 118: static safety boundary denies data export and privilege-free review",()=>{
  const exporter=readFileSync("scripts/legacy/export-source-coverage.ps1","utf8");
  const api=readFileSync("src/app/api/catalog/legacy-source-coverage/route.ts","utf8");
  const page=readFileSync("src/app/catalog/imports/reconciliation-ledger/page.tsx","utf8");
  assert.match(exporter,/Mode=Read/);
  assert.match(exporter,/SELECT COUNT\(\*\)/);
  assert.doesNotMatch(exporter,/\.CommandText\s*=\s*["\x27]SELECT\s+\*/i);
  assert.match(exporter,/Get-FileHash/);
  assert.match(exporter,/partial\./);
  assert.match(api,/pricing\.manage/);
  assert.match(api,/catalog\.reference_ranges\.manage/);
  assert.match(api,/organization_catalog_scope_required/);
  assert.match(api,/departmentScopeCount !== 0/);
  assert.match(api,/createdByUserId:session\.user\.id/);
  assert.match(api,/sourceType:"LEGACY_MDB_EXPORT"/);
  assert.match(api,/sourceIndependentlyVerified:false/);
  assert.match(api,/rowParityCertified:false/);
  assert.match(api,/action:"LEGACY_SOURCE_COVERAGE_REVIEWED"/);
  assert.doesNotMatch(api,/tx\.(?:labTest|priceList|referenceInterval|laboratoryResult|invoice)\.(?:create|update|delete|upsert)/);
  assert.match(page,/LegacySourceCoverageReview/);
});
