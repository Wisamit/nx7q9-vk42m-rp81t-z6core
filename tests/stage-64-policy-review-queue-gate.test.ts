import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";

const scope = {
  organizationId:"11000000-0000-4000-8000-000000000011",
  branchId:"22000000-0000-4000-8000-000000000022",
  batchId:"33000000-0000-4000-8000-000000000033",
  sourceChecksum:"e".repeat(64),
  authorUserId:"44000000-0000-4000-8000-000000000044",
};
const proposal = Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
const current = createPolicyDraftLedgerEntry(scope,proposal,1);
const revised = createPolicyDraftLedgerEntry(scope,{
  ...proposal,branchDelegation:"CENTRAL_WITH_BRANCH_SCOPE",
},2);
const one = {id:"55000000-0000-4000-8000-000000000055",
  actorUserId:scope.authorUserId,branchId:scope.branchId,newValues:current};
const two = {id:"66000000-0000-4000-8000-000000000066",
  actorUserId:scope.authorUserId,branchId:scope.branchId,newValues:revised};
function inspect(events:{id:string;actorUserId:string|null;branchId:string|null;newValues:unknown}[],
  candidateEventId=two.id) {
  return verifiedPolicyQueueCandidate({...scope,events,candidateEventId});
}

test("Stage 64: queue requires exact latest event plus intact full history",()=>{
  assert.equal(inspect([two,one])?.draft?.revision,2);
  assert.equal(inspect([two,one])?.draft?.approved,false);
  assert.equal(inspect([two,one])?.draft?.liveWrites,false);
  assert.equal(inspect([two,one],one.id),null);
  assert.equal(inspect([one],one.id)?.revisionCount,1);
  assert.equal(inspect([two]),null);
  assert.equal(inspect([two,one,{...one,id:"77777777-7777-4777-8777-777777777777"}]),null);
  assert.equal(inspect([{...two,actorUserId:"foreign"},one]),null);
  assert.equal(inspect([{...two,newValues:{...revised,activated:true}},one]),null);
  assert.equal(inspect([{...two,newValues:{...revised,sourceChecksum:"0".repeat(64)}},one]),null);
});

test("Stage 64: queue cannot advertise staged rows in revoked branches or changed identities",()=>{
  const row={entityType:"TEST",status:"WARNING",importedEntityId:null,
    sourceData:{id:scope.batchId,code:"TEST",nameEn:"Queue test",departmentId:null,status:"ACTIVE"},
    normalizedData:{id:scope.batchId,code:"TEST",nameEn:"Queue test",departmentId:null,
      branchId:scope.branchId,status:"ACTIVE"}};
  assert.equal(policyReviewIdentityScope([row],new Set([scope.branchId])).ok,true);
  assert.deepEqual(policyReviewIdentityScope([row],new Set()),{
    ok:false,error:"policy_review_batch_scope_changed",
  });
  assert.deepEqual(policyReviewIdentityScope([{
    ...row,normalizedData:{id:scope.batchId,branchId:scope.branchId,unitId:"not-uuid"},
  }],new Set([scope.branchId])),{
    ok:false,error:"policy_review_source_integrity_error",
  });
});

test("Stage 64: queue enforces current session intersected scopes, whole-batch validation and bounded history",()=>{
  const route=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  assert.match(route,/SELECT id FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/originalBranches\.has\(item\.branchId\)/);
  assert.match(route,/originalDepartments\.has\(item\.departmentId\)/);
  assert.match(route,/grantedBranchIds/);
  assert.match(route,/POLICY_DRAFT_HISTORY_LIMIT \+ 1/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/if \(!batchScope\.ok\) continue/);
  assert.ok(route.indexOf("validatePolicyReviewBatchScope(tx,") <
    route.indexOf("entries.push({"));
  assert.match(route,/createdByUserId: \{ not: session\.user\.id \}/);
  assert.match(route,/planPolicyQueueDecisionFetch\(draftIds, decisionCounts\)/);
  assert.match(route,/policy_queue_decision_snapshot_inconsistent/);
  assert.doesNotMatch(route,/policy_queue_decision_limit_exceeded/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.doesNotMatch(route, /tx\.(?:labTest|priceList|priceListItem|referenceInterval|catalogImportRow)\.(?:create|update|upsert|delete)/);
});
