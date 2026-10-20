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
const inspect=(type:string,initial=both,live=both,userId=reviewer)=>independentMappingInspection({
  entityType:type,authenticatedDraft:draft(type),
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
      status:"INDEPENDENT_DISCUSSION_INSPECTION_ONLY",
      category,revision:1,intent:"REQUEST_EXTERNAL_MAPPING",
      historicalObservationMatchesDraft:true,
      currentLiveObservationRevalidated:false,
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
    userId:reviewer,authorUserId:id(99),
    originalPermissions:clinical,currentPermissions:clinical,
  }),null);
  assert.equal(independentMappingInspection({
    entityType:"TEST",authenticatedDraft:null,
    userId:reviewer,authorUserId:context.authorUserId,
    originalPermissions:clinical,currentPermissions:clinical,
  }),null);
});

test("F2 independent mapping: route rechecks full HMAC/source/live scope, never grants action",()=>{
  const route=readFileSync(
    "src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const bundle=readFileSync(
    "src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const commit=readFileSync(
    "src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/export async function GET\(/);
  assert.doesNotMatch(route,/export async function (?:POST|PUT|PATCH|DELETE)\(/);
  assert.match(route,/original = permissionSet\(session\)/);
  assert.match(route,/current = new Set/);
  assert.match(route,/activeUser = await tx\.user\.findFirst/);
  assert.match(route,/batch\.createdByUserId === session\.user\.id/);
  assert.match(route,/resolveClinicalImportScope\(/);
  assert.match(route,/triagePermissionScope\(category, original\)/);
  assert.match(route,/triagePermissionScope\(category, current\)/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/reviewStageBatchMetadata\(batch\)/);
  assert.match(route,/verifyMappingDiscussionHistory\(/);
  assert.match(route,/signingSecret:secret/);
  assert.match(route,/take:MAPPING_DISCUSSION_HISTORY_LIMIT\+1/);
  assert.match(route,/independentMappingInspection\(/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/private, no-store/);
  assert.doesNotMatch(route,/independentMappingApprovalEligible:\\s*true/);
  assert.match(bundle,/mappingApproved:false/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
  assert.doesNotMatch(route,/tx\.(?:catalogImportRow|catalogImportBatch|auditEvent|labTest|referenceInterval|priceList|priceListItem)\.(?:create|update|delete|upsert)\(/);
});
