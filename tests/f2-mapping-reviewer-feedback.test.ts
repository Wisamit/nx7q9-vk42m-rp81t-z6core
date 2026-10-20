import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import {
  createMappingFeedbackDraft, parseMappingFeedbackDraft,
  verifyMappingFeedbackHistory, validMappingFeedbackDisposition,
  currentMappingFeedbackDisposition,
  type MappingFeedbackContext,
} from "../src/lib/catalog-mapping-reviewer-feedback.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const secret="synthetic-f2-feedback-private-test-key-32-bytes-strong";
const reviewer=id(6),reviewerB=id(7),author=id(5);
const base:MappingFeedbackContext={
  organizationId:id(1),batchId:id(2),branchId:id(3),rowId:id(4),
  authorUserId:author,sourceChecksum:"a".repeat(64),
  rowNumber:11,entityType:"TEST",
};
const evidence=(context=base,overrides:Record<string,unknown>={})=>
  createMappingFeedbackDraft(context,{
    reviewerUserId:reviewer,revision:1,previousDigest:null,
    authorDraftDigest:"b".repeat(64),observationToken:"c".repeat(64),
    disposition:"REQUEST_SOURCE_INSTALLATION_EVIDENCE",
    ...overrides,
  },secret);
const event=(draft:ReturnType<typeof evidence>,suffix=8)=>({
  id:id(suffix),actorUserId:draft.reviewerUserId,
  branchId:draft.branchId,newValues:draft,
});

test("F2: every native category yields HMAC-bound correction-only feedback with no implied approval",()=>{
  assert.equal(catalogExportTypes.size,10);
  for(const entityType of catalogExportTypes){
    const ctx={...base,entityType};
    const signed=evidence(ctx);
    assert.equal(parseMappingFeedbackDraft(signed,ctx,secret)?.digest,signed.digest);
    assert.equal(signed.reviewOnly,true);
    assert.equal(signed.sourceInstanceProven,false);
    assert.equal(signed.mappingApproved,false);
    assert.equal(signed.approved,false);
    assert.equal(signed.signingEnabled,false);
    assert.equal(signed.activated,false);
    assert.equal(signed.liveWrites,false);
    assert.deepEqual(verifyMappingFeedbackHistory({context:ctx,events:[event(signed)],secret}),
      {revision:1,latest:signed});
    assert.equal(JSON.stringify(signed).includes("unitPrice"),false);
  }
  assert.equal(validMappingFeedbackDisposition("APPROVE_MAPPING"),false);
  assert.equal(validMappingFeedbackDisposition("REQUEST_SOURCE_INSTALLATION_EVIDENCE"),true);
  assert.equal(validMappingFeedbackDisposition("RETURN_MAPPING_TO_AUTHOR"),true);
});

test("F2: tampered feedback, foreign tenant, forged signer and foreign/missing review history reject",()=>{
  const first=evidence();
  for(const patched of [
    {...first,disposition:"RETURN_MAPPING_TO_AUTHOR"},
    {...first,sourceInstanceProven:true},
    {...first,mappingApproved:true},
    {...first,approved:true},
    {...first,liveWrites:true},
    {...first,category:"FINANCIAL"},
    {...first,reviewerUserId:author},
    {...first,authorDraftDigest:"d".repeat(64)},
    {...first,observationToken:"e".repeat(64)},
    {...first,seal:{...first.seal,signature:"0".repeat(64)}},
    {...first,unexpected:"injection"},
  ])
    assert.equal(parseMappingFeedbackDraft(patched,base,secret),null);
  assert.equal(parseMappingFeedbackDraft(first,{...base,organizationId:id(99)},secret),null);
  assert.equal(parseMappingFeedbackDraft(first,base,"other-not-original-strong-32-byte-signing-secret"),null);
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[{...event(first),actorUserId:author}],secret,
  }),null);
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[{...event(first),branchId:id(87)}],secret,
  }),null);
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(first),event(first)],secret,
  }),null);
  assert.throws(()=>evidence(base,{reviewerUserId:author}));
  assert.throws(()=>evidence(base,{revision:101}));
  assert.throws(()=>evidence(base,{previousDigest:"invalid"}));
});

test("F2: revisions are immutable, independently authored, contiguous and may not reorder",()=>{
  const first=evidence();
  const second=evidence(base,{
    reviewerUserId:reviewerB,revision:2,previousDigest:first.digest,
    disposition:"RETURN_MAPPING_TO_AUTHOR",
  });
  assert.deepEqual(verifyMappingFeedbackHistory({
    context:base,events:[event(second,9),event(first,8)],secret,
  }),{revision:2,latest:second});
  // Two valid appends may share a millisecond; DB index/UUID ordering
  // can return either order. HMAC revision links, not physical ordering,
  // must establish the latest independent feedback.
  assert.deepEqual(verifyMappingFeedbackHistory({
    context:base,events:[event(first,8),event(second,9)],secret,
  }),{revision:2,latest:second});
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(second,9)],secret,
  }),null);
  const broken=evidence(base,{
    reviewerUserId:reviewerB,revision:2,previousDigest:"f".repeat(64),
  });
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(broken,9),event(first,8)],secret,
  }),null);
  // Duplicate, missing, or forked ordinal revisions still fail closed,
  // irrespective of the order in which MariaDB returns the records.
  const fork=evidence(base,{
    reviewerUserId:reviewerB,revision:1,previousDigest:null,
    disposition:"RETURN_MAPPING_TO_AUTHOR",
  });
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(fork,10),event(first,8)],secret,
  }),null);
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(second,9)],secret,
  }),null);
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(first,8),event(second,8)],secret,
  }),null);
});

test("F2: reviewer POST is feedback-only, strongly scoped and serialized behind GET-only inspection",()=>{
  const route=readFileSync(
    "src/app/api/catalog/imports/[id]/mapping-feedback/route.ts","utf8");
  const get=readFileSync(
    "src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const preflight=readFileSync(
    "src/lib/catalog-mapping-inspection-preflight.ts","utf8");
  const commit=readFileSync(
    "src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/export async function POST\(/);
  assert.doesNotMatch(route,/export async function (?:GET|PUT|PATCH|DELETE)\(/);
  assert.match(get,/export async function GET\(/);
  assert.doesNotMatch(get,/export async function (?:POST|PUT|PATCH|DELETE)\(/);
  assert.match(route,/runIndependentMappingPreflight\(request,context,async evidence=>/);
  assert.match(preflight,/SELECT id FROM organizations/);
  assert.match(preflight,/FOR UPDATE/);
  assert.match(preflight,/isolationLevel:"RepeatableRead"/);
  assert.match(preflight,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(preflight,/verifyMappingDiscussionHistory\(/);
  assert.match(preflight,/matchesCatalogDriftObservation\(history\.draft\.observationToken,token\)/);
  assert.match(preflight,/triagePermissionScope\(category, original\)/);
  assert.match(preflight,/triagePermissionScope\(category, current\)/);
  assert.match(preflight,/batch\.createdByUserId === session\.user\.id/);
  assert.match(route,/verifyMappingFeedbackHistory\(/);
  assert.match(route,/expectedAuthorDraftRevision!==evidence\.draft\.revision/);
  assert.match(route,/mapping_feedback_revision_conflict/);
  assert.match(route,/mapping_feedback_history_corrupt/);
  assert.match(route,/expectedAuthorDraftRevision/);
  assert.doesNotMatch(route,/body\.authorDraftDigest/);
  assert.match(route,/CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED/);
  assert.match(route,/sourceInstanceProven:false,mappingApproved:false/);
  assert.match(route,/liveWrites:false/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
  assert.doesNotMatch(route,/tx\.(?:labTest|testComponent|referenceInterval|priceList|priceListItem|priceListPackageItem|catalogImportRow|catalogImportBatch)\.(?:create|update|delete|upsert)\(/);
});

test("F2: correction is visible to the author ONLY for the current signed draft and live observation",()=>{
  const one=evidence();
  const history=verifyMappingFeedbackHistory({
    context:base,events:[event(one)],secret,
  });
  assert.ok(history);
  assert.equal(currentMappingFeedbackDisposition(
    history,one.authorDraftDigest,one.observationToken,
  ),"REQUEST_SOURCE_INSTALLATION_EVIDENCE");
  assert.equal(currentMappingFeedbackDisposition(
    history,"d".repeat(64),one.observationToken,
  ),null,"author's later draft supersedes reviewer feedback");
  assert.equal(currentMappingFeedbackDisposition(
    history,one.authorDraftDigest,"f".repeat(64),
  ),null,"new live observation invalidates the old reviewer feedback");
  assert.equal(currentMappingFeedbackDisposition(history,"bad",one.observationToken),null);
  assert.equal(currentMappingFeedbackDisposition({revision:0,latest:null},
    one.authorDraftDigest,one.observationToken),null);
  const second=evidence(base,{
    reviewerUserId:reviewerB,revision:2,previousDigest:one.digest,
    disposition:"RETURN_MAPPING_TO_AUTHOR",
  });
  const chained=verifyMappingFeedbackHistory({
    context:base,events:[event(one,8),event(second,9)],secret,
  });
  assert.ok(chained);
  assert.equal(currentMappingFeedbackDisposition(
    chained,one.authorDraftDigest,one.observationToken,
  ),"RETURN_MAPPING_TO_AUTHOR");
  assert.equal(verifyMappingFeedbackHistory({
    context:base,events:[event(one,8),{...event(second,9),actorUserId:author}],secret,
  }),null,"author must not impersonate an independent reviewer");
});

test("F2: author GET validates reviewer HMAC ledger, returns no actor/source and never becomes approval",()=>{
  const author=readFileSync(
    "src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const reviewer=readFileSync(
    "src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const helper=readFileSync(
    "src/lib/catalog-mapping-reviewer-feedback.ts","utf8");
  assert.match(author,/createdByUserId: session\.user\.id/);
  assert.match(author,/verifyIndependentExpertStage\(/);
  assert.match(author,/verifyMappingDiscussionHistory\(/);
  assert.match(author,/verifyMappingFeedbackHistory\(/);
  assert.match(author,/action:"CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED"/);
  assert.match(author,/currentMappingFeedbackDisposition\(/);
  assert.match(author,/reviewerFeedbackRevision:feedback\.revision/);
  assert.match(author,/reviewerFeedbackDisposition:currentFeedback/);
  assert.match(author,/mapping_discussion_reviewer_feedback_corrupt/);
  assert.match(reviewer,/currentMappingFeedbackDisposition\(/);
  assert.match(helper,/last\.authorDraftDigest===authorDraftDigest/);
  assert.match(helper,/last\.observationToken===currentObservationToken/);
  assert.match(author,/reviewOnly:true,approved:false,mappingApproved:false/);
  assert.doesNotMatch(author,/reviewerUserId:feedback\.latest/);
  assert.doesNotMatch(author,/feedback\.latest\?\.seal/);
});
