import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildF3LegacyExtractionManifest,type F3LegacySourceManifestInput}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {reconcileF3LegacySource,type F3LineageDecision}
  from "../src/lib/f3-legacy-source-reconciliation.ts";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
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
      ...LEGACY_COVERAGE_SOURCES.filter(x=>
        x.tableName!=="normal" && x.tableName!=="profile").map(({tableName})=>({
        name:tableName,
        columns:[{name:"label",accessType:"ACE_TYPE_202"}],
        rows:[],
      })),
    ],
  };
  const manifest=buildF3LegacyExtractionManifest(input,secret);
  const lineage:F3LineageDecision[]=manifest.rows.map((row,i)=>({
    organizationId:manifest.organizationId,sourceSha256:manifest.sourceSha256,
    digestKeyId:manifest.digestKeyId,...row,
    classification:"APPROVED_MAPPING",
    targetType:row.sourceTable==="normal"?"REFERENCE_INTERVAL":"PANEL",
    targetId:uuid(i+10),
  }));
  return {manifest,lineage};
};
const run=(lineage:F3LineageDecision[],manifest=build().manifest)=>
  reconcileF3LegacySource({
    manifest,lineage,tenantAndTargetScopeVerified:true,
  });

test("F3: offline manifest envelope matches the canonical source evidence contract",()=>{
  const {manifest}=build();
  const rejected = [
    ["tenantScope", false],["format",manifest.format!=="F3_LEGACY_SOURCE_FINGERPRINT_V1"],
    ["organizationId",!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(manifest.organizationId)],
    ["sourceSha256",!/^[0-9a-f]{64}$/.test(manifest.sourceSha256)],
    ["digestKeyId",!/^[0-9a-f]{64}$/.test(manifest.digestKeyId)],
    ["tableCount",manifest.tableCount!==manifest.tables.length],
    ["rowCount",manifest.rowCount!==manifest.rows.length],
    ["tableBounds",manifest.tableCount<1||manifest.tableCount>15],
    ["rowBounds",manifest.rowCount>20000],
    ["status",manifest.status!=="SYNTHETIC_OR_OFFLINE_EXTRACT_UNVERIFIED"],
    ["sourceBytes",manifest.sourceBytesVerified!==false],
    ["crossMapping",manifest.crossInstallationMappingApproved!==false],
    ["realParity",manifest.realLegacyParityVerified!==false],
    ["clinicalFinance",manifest.clinicalFinanceApproved!==false],
    ["operational",manifest.operationalReady!==false],
  ].filter(([,invalid])=>invalid).map(([reason])=>reason);
  assert.deepEqual(rejected,[],"valid signed metadata may not be rejected before row reconciliation");
  const reads:string[]=[];
  const watched=new Proxy(manifest,{get(object,field,receiver){
    if(typeof field==="string")reads.push(field);
    return Reflect.get(object,field,receiver);
  }});
  try{
    reconcileF3LegacySource({manifest:watched,lineage:[],
      tenantAndTargetScopeVerified:true});
  }catch(error){
    throw Error("F3 source envelope unexpectedly rejected after reading: "+
      reads.join(",")+"; "+String(error));
  }
  assert.deepEqual({
    format:manifest.format,status:manifest.status,
    organizationId:manifest.organizationId,
    sourceSha256Length:manifest.sourceSha256.length,
    digestKeyIdLength:manifest.digestKeyId.length,
    tableCount:manifest.tableCount,tableLength:manifest.tables.length,
    rowCount:manifest.rowCount,rowLength:manifest.rows.length,
    sourceBytesVerified:manifest.sourceBytesVerified,
    crossInstallationMappingApproved:manifest.crossInstallationMappingApproved,
    realLegacyParityVerified:manifest.realLegacyParityVerified,
    clinicalFinanceApproved:manifest.clinicalFinanceApproved,
    operationalReady:manifest.operationalReady,
  },{
    format:"F3_LEGACY_SOURCE_FINGERPRINT_V1",
    status:"SYNTHETIC_OR_OFFLINE_EXTRACT_UNVERIFIED",
    organizationId:uuid(1),sourceSha256Length:64,digestKeyIdLength:64,
    tableCount:15,tableLength:15,rowCount:3,rowLength:3,
    sourceBytesVerified:false,crossInstallationMappingApproved:false,
    realLegacyParityVerified:false,clinicalFinanceApproved:false,
    operationalReady:false,
  });
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
  }:row),manifest),/incompatible_source_target/);
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
  const falseDuplicate={...manifest,tables:manifest.tables.map(table=>
    table.sourceTable==="normal"?{
      ...table,duplicateContentRows:0,
    }:table)};
  assert.throws(()=>run(lineage,falseDuplicate),/duplicate_content_mismatch/);
});

test("F3: a valid source HMAC cannot be mapped to the wrong target class",()=>{
  const {manifest,lineage}=build();
  // normal is a REFERENCE_INTERVAL, profile is a PANEL: mapping either as
  // TEST would be a clinically dangerous but syntactically valid UUID.
  assert.throws(()=>run(lineage.map((entry,i)=>i===0?
    {...entry,targetType:"TEST"}:entry),manifest),
    /incompatible_source_target/);
  assert.throws(()=>run(lineage.map((entry,i)=>i===2?
    {...entry,targetType:"PRICE_LIST_ITEM"}:entry),manifest),
    /incompatible_source_target/);
  assert.throws(()=>run(lineage.map((entry,i)=>i===0?
    {...entry,sourceTable:entry.sourceTable.toUpperCase()}:entry),manifest),
    /foreign_or_duplicate_mapping/);
  const unknownTable={...manifest,tables:manifest.tables.map((entry,i)=>i===0?
    {...entry,sourceTable:"INJECTED"}:entry)};
  assert.throws(()=>run(lineage,unknownTable),/invalid_table_coverage/);
  for(const override of [
    {status:"VERIFIED_BY_UNTRUSTED_IMPORT"},
    {sourceBytesVerified:true},
    {crossInstallationMappingApproved:true},
    {clinicalFinanceApproved:true},
  ]){
    assert.throws(()=>run(lineage,{...manifest,...override} as typeof manifest),
      /invalid_source_evidence/);
  }
});

test("F3: Gropes can legitimately map to PANEL or PACKAGE but not an invented GROUP target",()=>{
  const input:F3LegacySourceManifestInput={
    organizationId:uuid(1),sourceSha256:"a".repeat(64),
    digestKeyId:"b".repeat(64),
    tables:[{name:"Gropes",
      columns:[{name:"label",accessType:"ACE_TYPE_202"}],
      rows:[{label:"Synthetic group"}]}],
  };
  const manifest=buildF3LegacyExtractionManifest(input,secret);
  const source=manifest.rows[0];
  const lineage:F3LineageDecision[]=[{
    organizationId:manifest.organizationId,sourceSha256:manifest.sourceSha256,
    digestKeyId:manifest.digestKeyId,...source,
    classification:"APPROVED_MAPPING",targetType:"GROUP",targetId:uuid(99),
  }];
  assert.throws(()=>run(lineage,manifest),/incompatible_source_target/);
  for(const supported of ["PANEL","PACKAGE"]){
    const mapped=run([{...lineage[0],targetType:supported}],manifest);
    assert.equal(mapped.dispositions.APPROVED_MAPPING,1);
    assert.equal(mapped.syntheticFullyClassified,false,
      "single-table evidence is not 15-table parity");
  }
  const deferred=run([{...lineage[0],classification:"UNRESOLVED",
    targetType:null,targetId:null}],manifest);
  assert.equal(deferred.syntheticFullyClassified,false);
  assert.equal(deferred.dispositions.UNRESOLVED,1);
});

test("F3: reconciliation reuses canonical multi-target contract, not one arbitrary guessed class",()=>{
  const {manifest,lineage}=build();
  const profileAsPackage=run(lineage.map((entry,i)=>i===2?
    {...entry,targetType:"PACKAGE"}:entry),manifest);
  assert.equal(profileAsPackage.syntheticFullyClassified,true,
    "profile may map to a package as defined by legacy-row-lineage");
  const unknownClass=run(lineage.map((entry,i)=>i===0?
    {...entry,classification:"UNRESOLVED",targetType:null,targetId:null}:entry),manifest);
  assert.equal(unknownClass.syntheticFullyClassified,false);
  const code=readFileSync("src/lib/f3-legacy-source-reconciliation.ts","utf8");
  assert.match(code,/import \{legacyRowTargets\}/);
  assert.match(code,/allowedTypes\.includes\(item\.targetType\)/);
});
