import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  nextPolicyReviewRecord, parsePolicyReviewRecord,
  validPolicyReviewReason, validPolicyReviewDomain, validPolicyReviewDisposition,
  domainReviewPermissions,
} from "../src/lib/catalog-policy-draft-review.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

const ctx={
  organizationId:"161fa6c2-7760-4cb9-b396-e0a73436fe3a",
  branchId:"2c2bf315-9085-4f41-bdd6-fcd4170d9c63",
  batchId:"678eb7d0-85c8-411a-b69b-a6367fb6bc18",
  sourceChecksum:"f".repeat(64),
};
const draftEventId="cf30288b-bd3b-4b9a-931f-b74bf0bc5fa1";
const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
const draft=createPolicyDraftLedgerEntry(ctx,proposal,1);

test("Stage 60 medical and financial objections are domain-specific and never approval",()=>{
  assert.equal(validPolicyReviewDomain("CLINICAL"),true);
  assert.equal(validPolicyReviewDomain("FINANCIAL"),true);
  assert.equal(validPolicyReviewDomain("APPROVED"),false);
  assert.equal(validPolicyReviewDisposition("NOTED_FOR_DISCUSSION"),true);
  assert.equal(validPolicyReviewDisposition("AUTHORIZE_PRICE_CHANGE"),false);
  assert.equal(validPolicyReviewReason("FINANCIAL","RETURN_FOR_REVISION","CLINICAL_AUTHORITY_UNCLEAR"),false);
  assert.equal(validPolicyReviewReason("CLINICAL","RETURN_FOR_REVISION","FINANCIAL_AUTHORITY_UNCLEAR"),false);
  assert.equal(validPolicyReviewReason("FINANCIAL","NOTED_FOR_DISCUSSION","BRANCH_SCOPE_UNCLEAR"),false);
  assert.equal(validPolicyReviewReason("FINANCIAL","NOTED_FOR_DISCUSSION","NO_FURTHER_OBJECTION_TO_DISCUSSION"),true);
  assert.equal(validPolicyReviewReason("CLINICAL","RETURN_FOR_REVISION","CLINICAL_SAFETY_REVIEW_UNDEFINED"),true);
  assert.equal(domainReviewPermissions("CLINICAL",new Set(["catalog.manage","catalog.reference_ranges.manage"])),true);
  assert.equal(domainReviewPermissions("FINANCIAL",new Set(["catalog.manage","pricing.manage"])),true);
  assert.equal(domainReviewPermissions("CLINICAL",new Set(["catalog.manage","pricing.manage"])),false);
  assert.equal(domainReviewPermissions("FINANCIAL",new Set(["pricing.manage"])),false);
  const medical=nextPolicyReviewRecord({
    draftEventId,draft,domain:"CLINICAL",disposition:"RETURN_FOR_REVISION",
    reasonCode:"CLINICAL_AUTHORITY_UNCLEAR",
  });
  assert.equal(medical.state,"PROCEDURAL_REVIEW_ONLY");
  assert.equal(medical.reviewOnly,true);
  assert.equal(medical.approved,false);
  assert.equal(medical.signingEnabled,false);
  assert.equal(medical.activated,false);
  assert.equal(medical.liveWrites,false);
  assert.deepEqual(parsePolicyReviewRecord(medical,{draftEventId,draft}),medical);
  assert.equal(parsePolicyReviewRecord({...medical,approved:true},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,liveWrites:true},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,signingEnabled:true},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,revision:2},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,proposalDigest:"e".repeat(64)},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,draftEventId:"other"},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord({...medical,reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION"},{draftEventId,draft}),null);
  assert.equal(parsePolicyReviewRecord(medical,{
    draftEventId,draft:createPolicyDraftLedgerEntry(ctx,proposal,2),
  }),null);
});

test("Stage 60 independent branch-and-live-role checks and fail-closed review paths",()=>{
  const detail=readFileSync("src/app/api/catalog/imports/[id]/policy-review/route.ts","utf8");
  const queue=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-policy-draft-review-queue.tsx","utf8");
  const page=readFileSync("src/app/catalog/expert-reviews/page.tsx","utf8");
  assert.match(detail,/SELECT id FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(detail,/createdByUserId === session\.user\.id/);
  assert.match(detail,/domainReviewPermissions\(input\.domain, originalPermissions\)/);
  assert.match(detail,/domainReviewPermissions\(input\.domain, currentPermissions\)/);
  assert.match(detail,/originalBranches\.has\(item\.branchId\)/);
  assert.match(detail,/resolveClinicalImportScope/);
  assert.match(detail,/policy_review_department_revoked/);
  assert.match(detail,/latest\.id !== input\.draftEventId/);
  assert.match(detail,/policy_review_stale_revision/);
  assert.match(detail,/policy_review_distinct_reviewers_required/);
  assert.match(detail,/policy_review_decision_conflict/);
  assert.match(detail,/policy_review_history_integrity_error/);
  assert.match(detail,/CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED/);
  assert.match(detail,/isolationLevel: "RepeatableRead"/);
  assert.match(detail,/bytes > 1024/);
  assert.doesNotMatch(detail,
    /tx\.(?:labTest|priceList|priceListItem|referenceInterval|catalogImportRow|catalogImportBatch|role|user)\.(?:create|update|upsert|delete)/);
  assert.match(queue,/createdByUserId: \{ not: session\.user\.id \}/);
  assert.match(queue,/parsePolicyReviewRecord/);
  assert.match(queue,/planPolicyQueueDecisionFetch\(draftIds, decisionCounts\)/);
  assert.match(queue,/policy_queue_decision_snapshot_inconsistent/);
  assert.doesNotMatch(queue,/decision_limit_exceeded/);
  assert.match(queue,/policy_queue_branch_revoked/);
  assert.match(ui,/independent policy-draft review/i);
  assert.match(ui,/مراجعة مستقلة لمسودات السياسة/);
  assert.match(ui,/NO_FURTHER_OBJECTION_TO_DISCUSSION/);
  assert.match(ui,/Record nonbinding review in Audit/);
  assert.match(ui,/approved !== false/);
  assert.match(ui,/signingEnabled !== false/);
  assert.match(page,/CatalogPolicyDraftReviewQueue/);
});
