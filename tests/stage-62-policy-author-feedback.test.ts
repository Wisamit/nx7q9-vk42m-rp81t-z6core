import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPolicyDraftLedgerEntry, policyKeys,
  type CatalogPolicyProposal } from "../src/lib/catalog-signatory-policy-draft.ts";
import { nextPolicyReviewRecord } from "../src/lib/catalog-policy-draft-review.ts";
import { policyDraftAuthorFeedback } from "../src/lib/catalog-policy-feedback.ts";

const context = { organizationId:"11111111-1111-4111-8111-111111111111",
  branchId:"22222222-2222-4222-8222-222222222222",
  batchId:"33333333-3333-4333-8333-333333333333", sourceChecksum:"a".repeat(64) };
const draftEventId="44444444-4444-4444-8444-444444444444";
const author="55555555-5555-4555-8555-555555555555";
const doctor="66666666-6666-4666-8666-666666666666";
const finance="77777777-7777-4777-8777-777777777777";
const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
const draft=createPolicyDraftLedgerEntry(context,proposal,1);
const clinicianReview=nextPolicyReviewRecord({draftEventId,draft,domain:"CLINICAL",
  disposition:"RETURN_FOR_REVISION",reasonCode:"CLINICAL_AUTHORITY_UNCLEAR"});
const financialReview=nextPolicyReviewRecord({draftEventId,draft,domain:"FINANCIAL",
  disposition:"NOTED_FOR_DISCUSSION",reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION"});
const feedback=(events: { actorUserId:string|null; newValues:unknown }[], revision=draft) =>
  policyDraftAuthorFeedback({ draftEventId, draft:revision, authorUserId:author, events });

test("Stage 62: two independent domain reviewers yield author-visible procedural feedback only",()=>{
  const empty=feedback([]);
  assert.equal(empty?.domains.CLINICAL.status,"PENDING");
  assert.equal(empty?.domains.FINANCIAL.reasonCode,null);
  const one=feedback([{actorUserId:doctor,newValues:clinicianReview}]);
  assert.equal(one?.domains.CLINICAL.status,"RETURN_FOR_REVISION");
  assert.equal(one?.domains.FINANCIAL.status,"PENDING");
  const completed=feedback([{actorUserId:doctor,newValues:clinicianReview},
    {actorUserId:finance,newValues:financialReview}]);
  assert.equal(completed?.domains.FINANCIAL.status,"NOTED_FOR_DISCUSSION");
  assert.equal(completed?.domains.CLINICAL.reasonCode,"CLINICAL_AUTHORITY_UNCLEAR");
  assert.equal(completed?.approved,false);
  assert.equal(completed?.signingEnabled,false);
  assert.equal(completed?.activated,false);
  assert.equal(completed?.liveWrites,false);
  assert.equal("actorUserId" in (completed||{}),false);
});

test("Stage 62: corrupted audit, duplicate domain/person, author self-review and stale revision fail closed",()=>{
  assert.equal(feedback([{actorUserId:author,newValues:clinicianReview}]),null);
  assert.equal(feedback([{actorUserId:null,newValues:clinicianReview}]),null);
  assert.equal(feedback([{actorUserId:doctor,newValues:clinicianReview},
    {actorUserId:doctor,newValues:financialReview}]),null);
  assert.equal(feedback([{actorUserId:doctor,newValues:clinicianReview},
    {actorUserId:finance,newValues:clinicianReview}]),null);
  assert.equal(feedback([{actorUserId:doctor,newValues:{...clinicianReview,approved:true}}]),null);
  assert.equal(feedback([{actorUserId:doctor,newValues:clinicianReview},
    {actorUserId:finance,newValues:financialReview},
    {actorUserId:"different",newValues:financialReview}]),null);
  const next=createPolicyDraftLedgerEntry(context,{...proposal,branchDelegation:"BRANCH_SPECIFIC"},2);
  assert.equal(feedback([{actorUserId:doctor,newValues:clinicianReview}],next),null);
  const corrupted={...financialReview,reasonCode:"CLINICAL_AUTHORITY_UNCLEAR"};
  assert.equal(feedback([{actorUserId:finance,newValues:corrupted}]),null);
});

test("Stage 62: author-only fully-scoped governance emits latest feedback; no authority grant",()=>{
  const api=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-governance-readiness.tsx","utf8");
  assert.match(api,/createdByUserId: session\.user\.id/);
  assert.match(api,/resolveClinicalImportScope/);
  assert.match(api,/policyDraftAuthorFeedback\(/);
  assert.match(api,/policy_draft_review_history_corrupt/);
  assert.match(api,/entityId: currentPolicyEventId/);
  assert.match(api,/take: 3/);
  assert.match(api,/currentPolicyEventId = recordedDraft\.id/);
  assert.match(api,/policyReviewFeedback: reviewFeedback/);
  assert.match(ui,/Independent reviewer feedback — NOT approval/);
  assert.match(ui,/ملاحظات المراجعين المستقلين — ليست اعتماداً/);
  assert.match(ui,/policyReviewFeedback\.revision === draft\.revision/);
  assert.match(ui,/Return.*for revision|Returned for revision/);
  assert.doesNotMatch(api,/tx\.(?:referenceInterval|priceList|labTest)\.(?:create|update|upsert|delete)/);
});
