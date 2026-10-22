import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseF3UnverifiedDigestManifest}
  from "../src/lib/f3-legacy-manifest-validator.ts";
import {f3LiveLineageTargetsVisible}
  from "../src/lib/f3-legacy-target-visibility.ts";
import {buildF3LegacyExtractionManifest}
  from "../src/lib/f3-legacy-extraction-manifest.ts";
import {reconcileF3LegacySource}
  from "../src/lib/f3-legacy-source-reconciliation.ts";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";

const org="00000000-0000-4000-8000-000000000001";
const secret="f3-synthetic-id-guard-regression-test-secret-32";
test("F3: full 36-char UUID is accepted identically by manifest, reconciliation and live target guards",async()=>{
  const manifest=buildF3LegacyExtractionManifest({
    organizationId:org,sourceSha256:"a".repeat(64),
    digestKeyId:"b".repeat(64),
    tables:LEGACY_COVERAGE_SOURCES.map(row=>({
      name:row.tableName,
      columns:[{name:"label",accessType:"ACE_TYPE_202"}],
      rows:[],
    })),
  },secret);
  assert.equal(parseF3UnverifiedDigestManifest(manifest,org).organizationId,org);
  const output=reconcileF3LegacySource({
    manifest,lineage:[],tenantAndTargetScopeVerified:true,
  });
  assert.equal(output.sourceRows,0);
  assert.equal(output.missingRows,0);
  assert.equal(output.originalMdbProven,false);
  assert.equal(await f3LiveLineageTargetsVisible({} as never,{
    organizationId:org,lineage:[],currentOrganizationScopeVerified:true,
  }),true);
});
test("F3: every source boundary has the same five UUID segments, rejecting truncated and malformed IDs",async()=>{
  const files=[
    "src/lib/f3-legacy-extraction-manifest.ts",
    "src/lib/f3-legacy-intake-pages.ts",
    "src/lib/f3-legacy-manifest-validator.ts",
    "src/lib/f3-legacy-source-reconciliation.ts",
    "src/lib/f3-legacy-target-scope.ts",
    "src/lib/f3-legacy-target-visibility.ts",
  ];
  for(const file of files){
    const code=readFileSync(file,"utf8");
    assert.match(code,
      /const UUID=\/\^\[.*?\]\{8\}-\[.*?\]\{4\}-\[.*?\]\{4\}-\[.*?\]\{4\}-\[.*?\]\{12\}\$\/i;/,
      file+" must accept complete 8-4-4-4-12 UUID, not a truncated 8-4-4-12");
  }
  const manifest=buildF3LegacyExtractionManifest({
    organizationId:org,sourceSha256:"a".repeat(64),digestKeyId:"b".repeat(64),
    tables:LEGACY_COVERAGE_SOURCES.map(row=>({
      name:row.tableName,columns:[{name:"label",accessType:"ACE_TYPE_202"}],
      rows:[],
    })),
  },secret);
  assert.throws(()=>parseF3UnverifiedDigestManifest(
    {...manifest,organizationId:"00000000-0000-4000-000000000001"},org));
  assert.equal(await f3LiveLineageTargetsVisible({} as never,{
    organizationId:"00000000-0000-4000-000000000001",lineage:[],
    currentOrganizationScopeVerified:true,
  }),false);
});
