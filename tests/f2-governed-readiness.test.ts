import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { catalogBundleAllowedSourceFields } from "../src/lib/catalog-bundle-source-boundary.ts";
import {
  f2GovernedReadinessPreview,F2_GOVERNED_APPLY_PREREQUISITES,
} from "../src/lib/catalog-f2-governed-readiness.ts";

const id="11111111-1111-4111-8111-111111111111";
function record(type: keyof typeof catalogBundleAllowedSourceFields){
  const data:Record<string,unknown>={};
  for(const field of catalogBundleAllowedSourceFields[type])data[field]=null;
  data.id=id;
  if(type!=="REFERENCE_INTERVAL" &&
     type!=="PRICE_LIST_ITEM" && type!=="PRICE_LIST_PACKAGE_ITEM")
    data.code="SAFE-SYNTHETIC";
  return data;
}
const preview=(type:string,source:unknown,live:unknown)=>
  f2GovernedReadinessPreview({
    entityType:type,sourceData:source,scopedLiveData:live,
    signedStageVerified:true,liveFieldObservationRevalidated:true,
  });

test("F2 two-package readiness: all ten complete native classes remain non-executable",()=>{
  assert.equal(catalogExportTypes.size,10);
  assert.equal(new Set(F2_GOVERNED_APPLY_PREREQUISITES).size,7);
  for(const type of catalogExportTypes){
    const s=record(type);
    const result=preview(type,s,structuredClone(s));
    assert.ok(result, type);
    assert.equal(result.status,"BLOCKED_EXTERNAL");
    assert.equal(result.reviewClass,type);
    assert.equal(result.phaseOne.signedStageVerified,true);
    assert.equal(result.phaseOne.liveFieldObservationRevalidated,true);
    assert.equal(result.phaseOne.projectedFieldCount,Object.keys(s).length);
    assert.equal(result.phaseOne.changedFieldCount,0);
    assert.deepEqual(result.phaseOne.changedFields,[]);
    assert.equal(result.phaseOne.sourceInstallationProven,false);
    assert.equal(result.phaseOne.portableForeignIdentifiers,false);
    assert.equal(result.phaseTwo.state,"GOVERNED_APPLY_NOT_AUTHORIZED");
    assert.deepEqual(result.phaseTwo.prerequisites,F2_GOVERNED_APPLY_PREREQUISITES);
    assert.equal(result.phaseTwo.independentClinicalConsentVerified,false);
    assert.equal(result.phaseTwo.independentFinanceConsentVerified,false);
    assert.equal(result.phaseTwo.approvalPolicyEffectiveDated,false);
    assert.equal(result.phaseTwo.executableApplyPlan,false);
    assert.equal(result.phaseTwo.atomicApplyEnabled,false);
    assert.equal(result.phaseTwo.correctiveReversalEnabled,false);
    assert.equal(result.phaseTwo.approvedRoundTripVerified,false);
    assert.equal(result.sourceInstanceProven,false);
    assert.equal(result.mappingApproved,false);
    assert.equal(result.approved,false);
    assert.equal(result.signingEnabled,false);
    assert.equal(result.activated,false);
    assert.equal(result.liveWrites,false);
    assert.equal(result.reviewOnly,true);
  }
});

test("F2 two-package readiness: all native top-level fields are included in value-free diff",()=>{
  for(const type of catalogExportTypes){
    const s=record(type);
    const field=type==="PRICE_LIST_ITEM"||type==="PRICE_LIST_PACKAGE_ITEM"
      ? "unitPrice":type==="REFERENCE_INTERVAL" ? "criticalHigh":
        type==="PANEL"||type==="PACKAGE" ? "items" : "updatedAt";
    assert.ok(Object.hasOwn(s,field),type+" "+field);
    const live=structuredClone(s);
    live[field]=field==="items" ? [{testId:id,displayOrder:2}]:
      field==="unitPrice"||field==="criticalHigh" ? "12345678.1250" :
      "2026-10-20T20:00:00.000Z";
    const r=preview(type,s,live);
    assert.ok(r,type);
    assert.deepEqual(r.phaseOne.changedFields,[field]);
    assert.equal(r.phaseOne.changedFieldCount,1);
    const response=JSON.stringify(r);
    assert.equal(response.includes("12345678"),false);
    assert.equal(response.includes("2026-10-20T"),false);
    assert.equal(response.includes(id),false);
    assert.equal(r.phaseTwo.atomicApplyEnabled,false);
  }
});

test("F2 two-package readiness: fails closed on missing/extra fields and untrusted or unconfirmed observations",()=>{
  const source=record("TEST");
  assert.equal(preview("UNSUPPORTED",source,source),null);
  assert.equal(preview("TEST",source,{...source,unknownFlag:true}),null);
  const partial={...source};delete partial.status;
  assert.equal(preview("TEST",partial,source),null);
  assert.equal(preview("TEST",source,partial),null);
  assert.equal(preview("TEST",null,source),null);
  assert.equal(preview("TEST",source,["not","a","record"]),null);
  assert.equal(f2GovernedReadinessPreview({
    entityType:"TEST",sourceData:source,scopedLiveData:source,
    signedStageVerified:false as true,liveFieldObservationRevalidated:true,
  }),null);
  assert.equal(f2GovernedReadinessPreview({
    entityType:"TEST",sourceData:source,scopedLiveData:source,
    signedStageVerified:true,liveFieldObservationRevalidated:false as true,
  }),null);
  assert.equal(preview("TEST",{...source,nameEn:Number.POSITIVE_INFINITY},source),null);
});

test("F2 two-package readiness: still GET-only, scoped and excluded from ordinary commit",()=>{
  const preflight=readFileSync("src/lib/catalog-mapping-inspection-preflight.ts","utf8");
  const get=readFileSync("src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const post=readFileSync("src/app/api/catalog/imports/[id]/mapping-feedback/route.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(preflight,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(preflight,/verifyMappingDiscussionHistory\(/);
  assert.match(preflight,/matchesCatalogDriftObservation\(history\.draft\.observationToken,token\)/);
  assert.match(preflight,/readCatalogLiveObservations\(tx,scope,grantedBranchIds/);
  assert.match(preflight,/f2GovernedReadinessPreview\(/);
  assert.match(preflight,/mapping_inspection_incomplete_projection/);
  assert.match(get,/readiness:evidence\.readiness/);
  assert.match(get,/export async function GET\(/);
  assert.doesNotMatch(get,/export async function POST\(/);
  assert.match(post,/export async function POST\(/);
  assert.doesNotMatch(post,/tx\.(?:labTest|referenceInterval|priceList|priceListItem|priceListPackageItem)\.(?:update|create|upsert|delete)\(/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
});
