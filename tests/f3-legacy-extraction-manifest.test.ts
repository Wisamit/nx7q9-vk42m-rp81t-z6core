import test from "node:test";
import assert from "node:assert/strict";
import {
  F3_LEGACY_MAX_ROWS,buildF3LegacyExtractionManifest,
  type F3LegacySourceManifestInput,
} from "../src/lib/f3-legacy-extraction-manifest.ts";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
const id="00000000-0000-4000-8000-000000000001";
const secret="synthetic-F3-row-evidence-key-never-use-in-production-32";
const legacyTables=LEGACY_COVERAGE_SOURCES.map(x=>x.tableName);
const fixture=():F3LegacySourceManifestInput=>({
  organizationId:id,sourceSha256:"a".repeat(64),
  digestKeyId:"b".repeat(64),
  tables:legacyTables.map((name,index)=>({
    name,columns:[
      {name:"test name",accessType:"Text (100)"},
      {name:"Normal",accessType:"Text (255)"},
    ],
    rows:name==="test"?[
      {"test name":"Synthetic CBC","Normal":"1.100000"},
      {"test name":"Synthetic CBC","Normal":"1.100000"},
      {"test name":"Synthetic CRP","Normal":"2.500000"},
    ]:[{"test name":"Synthetic "+index,"Normal":"0.000000"}],
  })),
});

test("F3: all 15 legacy-config tables produce stable source-index HMACs with no sensitive row values",()=>{
  const data=fixture();
  const proof=buildF3LegacyExtractionManifest(data,secret);
  assert.equal(proof.tableCount,15);
  assert.equal(proof.rowCount,17);
  assert.equal(proof.rows.length,17);
  assert.equal(proof.tables.find(t=>t.sourceTable==="test")?.duplicateContentRows,1);
  assert.deepEqual(proof.rows.filter(r=>r.sourceTable==="test")
    .map(r=>r.occurrence).sort((a,b)=>a-b),[1,1,2]);
  assert.equal(proof.rows.every(r=>/^[a-f0-9]{64}$/.test(r.rowDigest)),true);
  const bytes=JSON.stringify(proof);
  for(const value of ["Synthetic CBC","Synthetic CRP","1.100000","0.000000","2.500000"])
    assert.equal(bytes.includes(value),false,"no source row values may enter the fingerprint report");
  assert.equal(proof.sourceBytesVerified,false);
  assert.equal(proof.realLegacyParityVerified,false);
  assert.equal(proof.crossInstallationMappingApproved,false);
  assert.equal(proof.clinicalFinanceApproved,false);
  assert.equal(proof.operationalReady,false);
});

test("F3: Access row order does not change HMAC occurrence identities",()=>{
  const base=fixture(),first=buildF3LegacyExtractionManifest(base,secret);
  const shuffled=fixture();
  shuffled.tables=[...shuffled.tables].reverse().map(t=>({
    ...t,rows:[...t.rows].reverse(),
  }));
  const other=buildF3LegacyExtractionManifest(shuffled,secret);
  assert.deepEqual(other,first);
  assert.notDeepEqual(
    buildF3LegacyExtractionManifest(base,
      "different-F3-manifest-secret-not-production-123456789"),
    first,"a distinct signing secret must never replay the same row digest");
  assert.notDeepEqual(buildF3LegacyExtractionManifest(
    {...base,sourceSha256:"f".repeat(64)},secret),first);
  const rotated=buildF3LegacyExtractionManifest(
    {...base,digestKeyId:"f".repeat(64)},secret);
  assert.notDeepEqual(rotated.rows,first.rows,
    "rotating key identification must change source-row HMAC bindings");
});

test("F3: invalid Access schema, unlisted sensitive sources and accidental PHI fail closed",()=>{
  const base=fixture();
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[...base.tables.slice(0,-1),{...base.tables[0],name:"TEST"}]},secret),
    /invalid_table/);
  for(const forbidden of ["password","ID","ID2","idprice","result","profnam",
    "culture","cbc","Coag","Urine","Thyroid","Torch","fertility","widal","ZN"]){
    assert.throws(()=>buildF3LegacyExtractionManifest(
      {...base,tables:[{...base.tables[0],name:forbidden}]},secret),
      /invalid_table/);
  }
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[{...base.tables[0],columns:[
      ...base.tables[0].columns,{name:"NORMAL",accessType:"Memo"},
    ]}]},secret),/invalid_column/);
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[{...base.tables[0],name:"Test; DROP TABLE users"}]},secret),
    /invalid_table/);
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[{...base.tables[0],rows:[{"test name":"x",Normal:"y",unexpected:"secret"}]}]},secret),
    /invalid_row_columns/);
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[{...base.tables[0],rows:[{"test name":undefined as never,Normal:"y"}]}]},secret),
    /invalid_row_columns/);
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,tables:[{...base.tables[0],rows:[{"test name":"x".repeat(70000),Normal:"y"}]}]},secret),
    /row_too_large/);
  assert.throws(()=>buildF3LegacyExtractionManifest(base,"short"),/invalid_header/);
  assert.throws(()=>buildF3LegacyExtractionManifest(
    {...base,sourceSha256:"bad"},secret),/invalid_header/);
});

test("F3: exactly declared schema, bounded rows and deterministic source-reconciliation identifiers",()=>{
  const base=fixture();
  const head={...base,tables:[{...base.tables[0],rows:[]}]};
  const clean=buildF3LegacyExtractionManifest(head,secret);
  assert.equal(clean.rowCount,0);
  assert.equal(clean.tables.find(t=>t.sourceTable==="Test name")?.rows,0);
  assert.equal(F3_LEGACY_MAX_ROWS,20000);
  const oversized={...base,tables:[{
    ...base.tables[0],rows:Array.from({length:F3_LEGACY_MAX_ROWS+1},
      ()=>({"test name":"x",Normal:"y"})),
  }]};
  assert.throws(()=>buildF3LegacyExtractionManifest(oversized,secret),
    /too_many_rows/);
});
