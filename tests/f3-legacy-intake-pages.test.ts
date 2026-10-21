import test from "node:test";
import assert from "node:assert/strict";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
import {parseLegacyRowManifest} from "../src/lib/catalog-legacy-row-lineage.ts";
import {f3SourceDigestKeyId,f3BuildLegacyReviewPages}
  from "../src/lib/f3-legacy-intake-pages.ts";

const org="00000000-0000-4000-8000-000000000001";
const key="synthetic-F3-offline-ACE-fingerprint-key-never-production-32";
const extract=()=>({
  format:"F3_ACE_OFFLINE_CONFIGURATION_EXTRACT_V1",
  sourceName:"Family lab -test.mdb",sourceSha256:"a".repeat(64),
  sourceBytes:1024*1024,exportedAtUtc:"2026-10-21T12:00:00.000Z",
  sourceFileBytesHashedLocally:true,
  sourceIdentityExternallyAttested:false,migrated:false,
  tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>({
    name:tableName,
    columns:[{name:"label",accessType:"ACE_TYPE_202"}],
    rows:tableName==="test"?Array.from({length:501},(_,i)=>({
      label:"Synthetic private test "+i,
    })):[],
  })),
});
test("F3: offline ACE 15-table extract becomes strict 500-row hashed lineage pages, including zero-row tables",()=>{
  const result=f3BuildLegacyReviewPages({organizationId:org,extract:extract(),secret:key});
  assert.equal(result.manifest.tableCount,15);
  assert.equal(result.manifest.rowCount,501);
  assert.equal(result.pages.length,16);
  const testPages=result.pages.filter(p=>p.tableName==="test");
  assert.deepEqual(testPages.map(p=>[p.chunkIndex,p.chunkCount,p.rows.length]),
    [[0,2,500],[1,2,1]]);
  const zeros=result.pages.filter(p=>p.tableName!=="test");
  assert.equal(zeros.length,14);
  assert.ok(zeros.every(p=>p.rows.length===0 && p.sourceRowCount===0 &&
    p.chunkCount===1&&p.chunkIndex===0));
  assert.ok(result.pages.every(p=>p.includesPatientData===false));
  assert.deepEqual(result.pages.map(p=>parseLegacyRowManifest(p)),result.pages);
  assert.equal(result.manifest.sourceBytesVerified,false);
  assert.equal(result.sourceLocalHashOnly,true);
  assert.equal(result.productionApproved,false);
  const output=JSON.stringify(result);
  for(const value of ["Synthetic private test 0","Synthetic private test 500"])
    assert.equal(output.includes(value),false,"no raw Access row may appear in staged page");
});
test("F3: independent signing keys and local source bytes bind manifests without promoting them to original-data proof",()=>{
  const first=f3BuildLegacyReviewPages({organizationId:org,extract:extract(),secret:key});
  const second=f3BuildLegacyReviewPages({organizationId:org,extract:extract(),
    secret:"different-synthetic-ACE-HMAC-fingerprint-key-long-32"});
  assert.notEqual(first.manifest.digestKeyId,second.manifest.digestKeyId);
  assert.notEqual(first.pages.find(p=>p.rows.length)?.rows[0]?.rowDigest,
    second.pages.find(p=>p.rows.length)?.rows[0]?.rowDigest);
  assert.equal(f3SourceDigestKeyId(key).length,64);
  assert.throws(()=>f3SourceDigestKeyId("short"),/secret_unavailable/);
});
test("F3: offline extract header cannot claim real provenance, additional keys, clinical cutover or arbitrary source tables",()=>{
  const base=extract();
  for(const bad of [
    {...base,sourceIdentityExternallyAttested:true},
    {...base,migrated:true},
    {...base,sourceFileBytesHashedLocally:false},
    {...base,sourceName:"people.accdb"},
    {...base,sourceName:"../data.mdb"},
    {...base,sourceSha256:"fake"},
    {...base,sourceBytes:0},
    {...base,extra:{password:"bad"}},
    {...base,tables:[{...base.tables[0],name:"culture"}]},
    {...base,tables:[{...base.tables[0],name:"Not Registered"}]},
  ]){
    assert.throws(()=>f3BuildLegacyReviewPages({
      organizationId:org,extract:bad,secret:key,
    }),/f3_/);
  }
  assert.throws(()=>f3BuildLegacyReviewPages({
    organizationId:org,extract:base,secret:"short",
  }),/f3_hmac_secret_unavailable/);
});
