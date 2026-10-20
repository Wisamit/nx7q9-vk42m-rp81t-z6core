import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMappingDiscussionDraft } from "../src/lib/catalog-mapping-discussion-draft.ts";
import { independentMappingInspection } from "../src/lib/catalog-mapping-independent-inspection.ts";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const context={
  organizationId:id(1),batchId:id(2),branchId:id(3),
  rowId:id(4),authorUserId:id(5),sourceChecksum:"a".repeat(64),
  rowNumber:9,entityType:"TEST",
};
const secret="f2-mapping-inspection-only-unit-test-strong-key-secret";
const reviewer=id(6);
const permissions=(...codes:string[])=>new Set(["catalog.manage",...codes]);
const clinical=permissions("catalog.reference_ranges.manage");
const financial=permissions("pricing.manage");
const both=permissions("catalog.reference_ranges.manage","pricing.manage");
const draft=(type:string)=>createMappingDiscussionDraft({...context,entityType:type},{
  revision:1,previousDigest:null,observationToken:"b".repeat(64),
  intent:"REQUEST_EXTERNAL_MAPPING",
},secret);
const inspect=(type:string,initial=both,live=both,userId=reviewer,
  currentToken="b".repeat(64))=>independentMappingInspection({
  entityType:type,authenticatedDraft:draft(type),currentObservationToken:currentToken,
  userId,authorUserId:context.authorUserId,originalPermissions:initial,
  currentPermissions:live,
});

test("F2 independent mapping: exhaustive ten-class review permission & categorical metadata only",()=>{
  assert.equal(catalogExportTypes.size,10);
  for(const type of catalogExportTypes){
    const category = ["PANEL","PACKAGE"].includes(type) ? "CROSS_DOMAIN" :
      ["PRICE_LIST","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM"].includes(type)
        ? "FINANCIAL":"CLINICAL";
    const grant=category==="CROSS_DOMAIN"?both:category==="FINANCIAL"?financial:clinical;
    const view=inspect(type,grant,grant);
    assert.ok(view,type);
    assert.deepEqual(view,{
      status:"INDEPENDENT_FRESH_OBSERVATION_INSPECTION_ONLY",
      category,revision:1,intent:"REQUEST_EXTERNAL_MAPPING",
      historicalObservationMatchesDraft:true,
      currentLiveObservationRevalidated:true,
      independentMappingApprovalEligible:false,
      sourceInstanceProven:false,mappingApproved:false,
      signingEnabled:false,reviewOnly:true,
      approved:false,activated:false,liveWrites:false,
    },type);
    const serialized=JSON.stringify(view);
    for(const prohibited of [context.organizationId,context.batchId,context.rowId,
      context.authorUserId,context.sourceChecksum,draft(type).observationToken,
      secret,"unitPrice","lowValue","highValue","targetId"])
      assert.equal(serialized.includes(prohibited),false,type+":"+prohibited);
  }
});

test("F2 independent mapping: author, revoked roles, cross-domain and unknown classes are denied",()=>{
  assert.equal(inspect("TEST",both,both,context.authorUserId),null);
  assert.equal(inspect("UNKNOWN"),null);
  assert.equal(inspect("TEST",both,both,reviewer,"a".repeat(64)),null);
  assert.equal(inspect("TEST",financial,financial),null);
  assert.equal(inspect("PRICE_LIST",clinical,clinical),null);
  assert.equal(inspect("PANEL",clinical,clinical),null);
  assert.equal(inspect("PACKAGE",financial,financial),null);
  assert.equal(inspect("TEST",clinical,permissions()),null);
  assert.equal(inspect("PRICE_LIST",financial,permissions()),null);
  assert.equal(inspect("TEST",permissions(),clinical),null);
  assert.equal(inspect("TEST",clinical,permissions()),null);
  const original=draft("TEST");
  assert.equal(independentMappingInspection({
    entityType:"TEST",authenticatedDraft:original,
    currentObservationToken:original.observationToken,
    userId:reviewer,authorUserId:id(99),
    originalPermissions:clinical,currentPermissions:clinical,
  }),null);
  assert.equal(independentMappingInspection({
    entityType:"TEST",authenticatedDraft:null,
    currentObservationToken:"b".repeat(64),
    userId:reviewer,authorUserId:context.authorUserId,
    originalPermissions:clinical,currentPermissions:clinical,
  }),null);
});

test("F2 independent mapping: route rechecks full HMAC/source/live scope, never grants action",()=>{
  const route=readFileSync(
    "src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const preflight=readFileSync(
    "src/lib/catalog-mapping-inspection-preflight.ts","utf8");
  const bundle=readFileSync(
    "src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const commit=readFileSync(
    "src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/export async function GET\(/);
  assert.match(route,/runIndependentMappingPreflight\(request,context\)/);
  assert.match(preflight,/export async function runIndependentMappingPreflight\(/);
  assert.doesNotMatch(route,/export async function (?:POST|PUT|PATCH|DELETE)\(/);
  assert.match(preflight,/original = permissionSet\(session\)/);
  assert.match(preflight,/current = new Set/);
  assert.match(preflight,/activeUser = await tx\.user\.findFirst/);
  assert.match(preflight,/batch\.createdByUserId === session\.user\.id/);
  assert.match(preflight,/resolveClinicalImportScope\(/);
  assert.match(preflight,/triagePermissionScope\(category, original\)/);
  assert.match(preflight,/triagePermissionScope\(category, current\)/);
  assert.match(preflight,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(preflight,/reviewStageBatchMetadata\(batch\)/);
  assert.match(preflight,/verifyMappingDiscussionHistory\(/);
  assert.match(preflight,/signingSecret:secret/);
  assert.match(preflight,/take:MAPPING_DISCUSSION_HISTORY_LIMIT\+1/);
  assert.match(preflight,/independentMappingInspection\(/);
  assert.match(preflight,/readCatalogLiveObservations\(tx,scope,grantedBranchIds/);
  assert.match(preflight,/catalogDriftObservationToken\(secret,batch\.sourceChecksum/);
  assert.match(preflight,/matchesCatalogDriftObservation\(history\.draft\.observationToken,token\)/);
  const shared=readFileSync("src/lib/catalog-live-observation.ts","utf8");
  assert.match(bundle,/readCatalogLiveObservations\(tx,liveScope,branchIds,idsByType\)/);
  assert.match(shared,/JSON\.parse\(JSON\.stringify\(current\)\)/);
  assert.match(preflight,/FOR UPDATE/);
  assert.match(preflight,/isolationLevel:"RepeatableRead"/);
  assert.match(preflight,/private, no-store/);
  assert.doesNotMatch(preflight,/independentMappingApprovalEligible:\\s*true/);
  assert.match(bundle,/mappingApproved:false/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
  assert.doesNotMatch(route,/tx\.(?:catalogImportRow|catalogImportBatch|auditEvent|labTest|referenceInterval|priceList|priceListItem)\.(?:create|update|delete|upsert)\(/);
});
