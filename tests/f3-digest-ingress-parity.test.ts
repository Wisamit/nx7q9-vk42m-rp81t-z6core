import test from "node:test";
import assert from "node:assert/strict";
import {buildF3LegacyExtractionManifest}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {parseF3UnverifiedDigestManifest}
  from "../src/lib/f3-legacy-manifest-validator.ts";
import {reconcileF3LegacySource}
  from "../src/lib/f3-legacy-source-reconciliation.ts";
import {LEGACY_COVERAGE_SOURCES}
  from "../src/lib/legacy-source-coverage.ts";

const organizationId="00000000-0000-4000-8000-000000000001";
const secret="synthetic-F3-HTTP-ingress-test-key-only-never-live-12345";
const manifest=()=>buildF3LegacyExtractionManifest({
  organizationId,sourceSha256:"a".repeat(64),digestKeyId:"b".repeat(64),
  tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>({
    name:tableName,
    columns:[{name:"label",accessType:"ACE_TYPE_202"}],
    rows:tableName==="normal"?[
      {label:"Synthetic source interval"},
      {label:"Synthetic source interval"},
      {label:"Synthetic second interval"},
    ]:[],
  })),
},secret);
type Manifest=ReturnType<typeof manifest>;
const parse=(value:unknown)=>parseF3UnverifiedDigestManifest(value,organizationId);
const clone=(value:Manifest):Manifest=>structuredClone(value);

test("F3 HTTP ingress: intact duplicate-bearing 15-table manifest retains full row parity",()=>{
  const value=manifest();
  assert.equal(value.tableCount,15);
  assert.equal(value.tables.find(x=>x.sourceTable==="normal")?.duplicateContentRows,1);
  assert.deepEqual(parse(value),value);
  const report=reconcileF3LegacySource({
    manifest:parse(value),lineage:[],tenantAndTargetScopeVerified:true,
  });
  assert.equal(report.sourceRows,3);
  assert.equal(report.missingRows,3);
  assert.equal(report.syntheticFullyClassified,false);
  assert.equal(report.productionReady,false);
});

test("F3 HTTP ingress: no omitted, transplanted or duplicate occurrence may reach SQL",()=>{
  const base=manifest();
  const minus=clone(base);
  minus.rows=[...minus.rows.slice(1)];
  assert.throws(()=>parse(minus),/f3_manifest_unverified_/);
  const copied=clone(base);
  copied.rows=[copied.rows[0],copied.rows[0],...copied.rows.slice(2)];
  assert.throws(()=>parse(copied),/f3_manifest_unverified_/);
  const moved=clone(base);
  moved.rows=[{...moved.rows[0],sourceTable:"test"},...moved.rows.slice(1)];
  assert.throws(()=>parse(moved),/f3_manifest_unverified_/);
  const changedSchema=clone(base);
  changedSchema.rows=[{...changedSchema.rows[0],
    sourceSchemaSha256:"c".repeat(64)},...changedSchema.rows.slice(1)];
  assert.throws(()=>parse(changedSchema),/f3_manifest_unverified_/);
});

test("F3 HTTP ingress: sparse, forged and non-contiguous duplicate ordinals fail closed",()=>{
  const base=manifest();
  const normal=base.rows.filter(x=>x.sourceTable==="normal");
  const repeated=normal.find(x=>x.occurrence===2);
  assert.ok(repeated);
  const gap=clone(base);
  gap.rows=gap.rows.map(row=>row.rowDigest===repeated.rowDigest &&
      row.occurrence===repeated.occurrence
    ?{...row,occurrence:3}:row);
  assert.throws(()=>parse(gap),/f3_manifest_unverified_occurrence_gap/);
  const tooLarge=clone(base);
  tooLarge.rows=[{...tooLarge.rows[0],occurrence:20001},
    ...tooLarge.rows.slice(1)];
  assert.throws(()=>parse(tooLarge),/f3_manifest_unverified_schema_or_occurrence/);
  const fractional=clone(base);
  fractional.rows=[{...fractional.rows[0],occurrence:1.5},
    ...fractional.rows.slice(1)];
  assert.throws(()=>parse(fractional),/f3_manifest_unverified_row/);
});

test("F3 HTTP ingress: manipulated per-table counts and duplicate declarations are rejected",()=>{
  const base=manifest();
  const count=clone(base);
  count.tables=count.tables.map(t=>t.sourceTable==="normal"?
    {...t,rows:t.rows+1}:t);
  assert.throws(()=>parse(count),/f3_manifest_unverified_table_parity/);
  const dups=clone(base);
  dups.tables=dups.tables.map(t=>t.sourceTable==="normal"?
    {...t,duplicateContentRows:0}:t);
  assert.throws(()=>parse(dups),/f3_manifest_unverified_table_parity/);
  const total=clone(base);
  total.rowCount=total.rowCount+1;
  total.rows=[...total.rows,{...total.rows[0],occurrence:3}];
  assert.throws(()=>parse(total),/f3_manifest_unverified_/);
});
