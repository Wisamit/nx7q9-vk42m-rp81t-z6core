import test from "node:test";
import assert from "node:assert/strict";
import {buildF3LegacyExtractionManifest,type F3LegacySourceManifestInput}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {reconcileF3LegacySource,type F3LineageDecision}
  from "../src/lib/f3-legacy-source-reconciliation.ts";
const uuid=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const secret="f3-synthetic-reconciliation-secret-never-deploy-123456";
const build=()=>{
  const input:F3LegacySourceManifestInput={
    organizationId:uuid(1),sourceSha256:"a".repeat(64),
    digestKeyId:"b".repeat(64),
    tables:[
      {name:"normal",columns:[{name:"test name",accessType:"ACE_TYPE_202"}],
        rows:[{"test name":"Synthetic Hb"},{"test name":"Synthetic Hb"}]},
      {name:"profile",columns:[{name:"profilname",accessType:"ACE_TYPE_202"}],
        rows:[{"profilname":"Synthetic Cbc"}]},
      ...Array.from({length:13},(_,i)=>({
        name:"Config"+String(i+1),
        columns:[{name:"label",accessType:"ACE_TYPE_202"}],
        rows:[],
      })),
    ],
  };
  const manifest=buildF3LegacyExtractionManifest(input,secret);
  const lineage:F3LineageDecision[]=manifest.rows.map((row,i)=>({
    organizationId:manifest.organizationId,sourceSha256:manifest.sourceSha256,
    digestKeyId:manifest.digestKeyId,...row,
    classification:"APPROVED_MAPPING",targetType:"TEST",targetId:uuid(i+10),
  }));
  return {manifest,lineage};
};
const run=(lineage:F3LineageDecision[],manifest=build().manifest)=>
  reconcileF3LegacySource({
    manifest,lineage,tenantAndTargetScopeVerified:true,
  });

test("F3: synthetic row-to-target classifications reconcile exact schema/HMAC occurrence IDs",()=>{
  const {manifest,lineage}=build();
  const r=run(lineage,manifest);
  assert.equal(r.sourceRows,3);
  assert.equal(manifest.tableCount,15);
  assert.equal(r.matchedRows,3);
  assert.equal(r.missingRows,0);
  assert.equal(r.duplicates,1);
  assert.equal(r.manyToOneTargets,0);
  assert.equal(r.dispositions.APPROVED_MAPPING,3);
  assert.equal(r.syntheticFullyClassified,true);
  assert.equal(r.originalMdbProven,false);
  assert.equal(r.qualifiedMappingApproved,false);
  assert.equal(r.productionReady,false);
  const result=JSON.stringify(r);
  for(const value of ["Synthetic Hb","Synthetic Cbc",uuid(10),manifest.rows[0].rowDigest])
    assert.equal(result.includes(value),false,
      "privacy-safe reconciliation report must hide raw values, UUIDs and HMAC");
});

test("F3: missing, ambiguous, not imported and many-to-one target cases are reported, not guessed",()=>{
  const {manifest,lineage}=build();
  const missing=run(lineage.slice(0,2),manifest);
  assert.equal(missing.missingRows,1);
  assert.equal(missing.syntheticFullyClassified,false);
  const ambiguous=run(lineage.map((row,i)=>i===0?{
    ...row,classification:"AMBIGUOUS",targetType:null,targetId:null,
  }:row),manifest);
  assert.equal(ambiguous.dispositions.AMBIGUOUS,1);
  assert.equal(ambiguous.syntheticFullyClassified,false);
  const skipped=run(lineage.map((row,i)=>i===0?{
    ...row,classification:"NOT_IMPORTED",targetType:null,targetId:null,
  }:row),manifest);
  assert.equal(skipped.dispositions.NOT_IMPORTED,1);
  const collision=run(lineage.map((row,i)=>i===1?{
    ...row,targetId:lineage[0].targetId,
  }:row),manifest);
  assert.equal(collision.manyToOneTargets,1);
  assert.equal(collision.syntheticFullyClassified,false);
});

test("F3: mismatched tenant, schema, source and duplicate/extraneous ledger keys fail closed",()=>{
  const {manifest,lineage}=build();
  for(const patch of [
    {organizationId:uuid(99)},{sourceSha256:"f".repeat(64)},
    {digestKeyId:"e".repeat(64)},{rowDigest:"f".repeat(64)},
    {sourceSchemaSha256:"e".repeat(64)},{occurrence:999},
  ]){
    assert.throws(()=>run([{...lineage[0],...patch},...lineage.slice(1)],manifest),
      /foreign_or_duplicate_mapping/);
  }
  assert.throws(()=>run([lineage[0],lineage[0],...lineage.slice(1)],manifest),
    /foreign_or_duplicate_mapping/);
  assert.throws(()=>run(lineage.map((row,i)=>i===0?{
    ...row,classification:"MAPPED",targetId:null,
  }:row),manifest),/unverified_target_identity/);
  assert.throws(()=>run(lineage.map((row,i)=>i===0?{
    ...row,classification:"UNRESOLVED",targetId:uuid(80),targetType:"TEST",
  }:row),manifest),/unreviewed_target_link/);
  assert.throws(()=>reconcileF3LegacySource({
    manifest,lineage,tenantAndTargetScopeVerified:false as true,
  }),/invalid_source_evidence/);
});

test("F3: tampered table totals, duplicate counters and source row parity cannot pass",()=>{
  const {manifest,lineage}=build();
  const broken={...manifest,tables:manifest.tables.map((table,i)=>i===0?{
    ...table,rows:table.rows+1,
  }:table)};
  assert.throws(()=>run(lineage,broken),/row_count_mismatch/);
  const duplication={...manifest,tables:manifest.tables.map((table,i)=>i===0?{
    ...table,duplicateContentRows:table.rows+1,
  }:table)};
  assert.throws(()=>run(lineage,duplication),/invalid_table_coverage/);
  const fakeRow={...manifest,rows:[manifest.rows[0],manifest.rows[0],
    ...manifest.rows.slice(2)]};
  assert.throws(()=>run(lineage,fakeRow),/duplicate_source_identity/);
  const gap={...manifest,rows:manifest.rows.map((row,i)=>i===0?{
    ...row,occurrence:3,
  }:row)};
  assert.throws(()=>run(lineage,gap),/noncontiguous_occurrence/);
  const falseDuplicate={...manifest,tables:manifest.tables.map((table,i)=>i===0?{
    ...table,duplicateContentRows:0,
  }:table)};
  assert.throws(()=>run(lineage,falseDuplicate),/duplicate_content_mismatch/);
});
