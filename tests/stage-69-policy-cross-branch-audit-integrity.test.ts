import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  verifyBranchScopedPolicyDraftHistory, policyAuditBranchesMatch,
} from "../src/lib/catalog-policy-draft-history.ts";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

const id=(v:number)=>"99999999-9999-4999-8999-"+String(v).padStart(12,"0");
const scope={organizationId:id(1),batchId:id(2),branchId:id(3),
  authorUserId:id(4),sourceChecksum:"a".repeat(64)};
const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
const old={id:id(5),actorUserId:scope.authorUserId,branchId:scope.branchId,
  newValues:createPolicyDraftLedgerEntry(scope,proposal,1)};
const latest={id:id(6),actorUserId:scope.authorUserId,branchId:scope.branchId,
  newValues:createPolicyDraftLedgerEntry(scope,{...proposal,branchDelegation:"BRANCH_SPECIFIC"},2)};

test("Stage 69: full history and queue reject a valid-looking foreign-branch revision",()=>{
  assert.equal(verifyBranchScopedPolicyDraftHistory({...scope,events:[latest,old]})?.revisionCount,2);
  assert.equal(verifiedPolicyQueueCandidate({...scope,events:[latest,old],
    candidateEventId:latest.id})?.draft?.revision,2);
  for(const corrupted of [
    [{...latest,branchId:id(9)},old],
    [latest,{...old,branchId:id(9)}],
    [{...latest,branchId:null},old],
  ]){
    assert.equal(verifyBranchScopedPolicyDraftHistory({...scope,events:corrupted}),null);
    assert.equal(verifiedPolicyQueueCandidate({...scope,events:corrupted,
      candidateEventId:latest.id}),null);
  }
  assert.equal(verifyBranchScopedPolicyDraftHistory({...scope,events:[old]} )?.revisionCount,1);
});

test("Stage 69: independent reviewer comment branch is never silently hidden",()=>{
  assert.equal(policyAuditBranchesMatch([],scope.branchId),true);
  assert.equal(policyAuditBranchesMatch([{branchId:scope.branchId}],scope.branchId),true);
  assert.equal(policyAuditBranchesMatch([{branchId:scope.branchId},{branchId:id(11)}],
    scope.branchId),false);
  assert.equal(policyAuditBranchesMatch([{branchId:null}],scope.branchId),false);
});

test("Stage 69: author, detail GET/POST and discovery query every same-tenant policy event",()=>{
  const files=[
    "src/app/api/catalog/imports/[id]/bundle-drift/route.ts",
    "src/app/api/catalog/imports/[id]/policy-review/route.ts",
    "src/app/api/catalog/imports/policy-review-queue/route.ts",
  ].map(p=>readFileSync(p,"utf8"));
  const [author,reviewer,queue]=files;
  for(const route of [author,reviewer]){
    assert.match(route,/verifyBranchScopedPolicyDraftHistory\(/);
    assert.match(route,/POLICY_DRAFT_HISTORY_LIMIT \+ 1/);
    assert.match(route,/select: \{ id: true, actorUserId: true, branchId: true, newValues: true \}/);
    assert.match(route,/policyAuditBranchesMatch\(/);
    assert.match(route,/select: \{ actorUserId: true, branchId: true, newValues: true \}/);
    assert.match(route,/organizationId,/);
    assert.match(route,/FOR UPDATE/);
    assert.match(route,/isolationLevel: "RepeatableRead"/);
  }
  assert.match(queue,/verifiedPolicyQueueCandidate\(/);
  assert.match(queue,/POLICY_DRAFT_HISTORY_LIMIT \+ 1/);
  assert.match(queue,/select: \{ id: true, actorUserId: true, branchId: true, newValues: true \}/);
  assert.match(queue,/decided\.some\(d => d\.branchId !== scope\.branchId\)/);
  assert.match(queue,/if \(!batchScope\.ok\) continue/);
  assert.match(queue,/approval: false, signingEnabled: false/);
  assert.doesNotMatch(files.join("\n"),
    /tx\.(?:labTest|priceList|priceListItem|referenceInterval|catalogImportRow)\.(?:create|update|upsert|delete)/);
});
