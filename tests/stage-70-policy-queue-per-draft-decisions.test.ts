import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planPolicyQueueDecisionFetch, POLICY_QUEUE_REVIEWS_PER_DRAFT,
} from "../src/lib/catalog-policy-queue-decision-plan.ts";

const id=(n:number)=>"70000000-0000-4000-8000-"+String(n).padStart(12,"0");
const counts=(pairs:[number,number][])=>pairs.map(([n,amount])=>({
  entityId:id(n),_count:{_all:amount},
}));

test("Stage 70: 201+ legitimate decisions across different drafts do not invalidate the page",()=>{
  const drafts=Array.from({length:100},(_,i)=>id(i));
  const grouped=counts(Array.from({length:100},(_,i):[number,number]=>[i,2]));
  const plan=planPolicyQueueDecisionFetch(drafts,grouped);
  assert.ok(plan);
  assert.equal(POLICY_QUEUE_REVIEWS_PER_DRAFT,2);
  assert.equal(plan.safeDraftIds.length,100);
  assert.equal(plan.corruptDraftIds.size,0);
  assert.equal(plan.maxRows,201);
  assert.equal([...plan.expectedCounts.values()].reduce((a,b)=>a+b,0),200);
  const withExtra=planPolicyQueueDecisionFetch([...drafts,id(100)],
    [...grouped,...counts([[100,2]])]);
  assert.ok(withExtra);
  assert.equal(withExtra.safeDraftIds.length,101);
  assert.equal(withExtra.maxRows,203);
  assert.equal([...withExtra.expectedCounts.values()].reduce((a,b)=>a+b,0),202);
});

test("Stage 70: a poisoned 3+ decision draft is individually excluded, not the whole page",()=>{
  const draftIds=[id(0),id(1),id(2),id(3),id(4)];
  const plan=planPolicyQueueDecisionFetch(draftIds,counts([
    [0,3],[1,2],[2,1],[3,4],
  ]));
  assert.ok(plan);
  assert.deepEqual(plan.safeDraftIds,[id(1),id(2),id(4)]);
  assert.deepEqual([...plan.corruptDraftIds],[id(0),id(3)]);
  assert.equal(plan.maxRows,7);
  assert.equal(plan.expectedCounts.get(id(4)),undefined);
  assert.equal(plan.expectedCounts.get(id(1)),2);
});

test("Stage 70: malformed count snapshots fail closed",()=>{
  const drafts=[id(1),id(2)];
  assert.equal(planPolicyQueueDecisionFetch(drafts,counts([[1,1],[1,2]])),null);
  assert.equal(planPolicyQueueDecisionFetch([id(1),id(1)],counts([[1,1]])),null);
  assert.equal(planPolicyQueueDecisionFetch(drafts,counts([[3,1]])),null);
  for (const number of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])
    assert.equal(planPolicyQueueDecisionFetch(drafts,counts([[1,number]])),null);
  assert.deepEqual(planPolicyQueueDecisionFetch([],[]),{
    safeDraftIds:[],corruptDraftIds:new Set(),expectedCounts:new Map(),maxRows:1,
  });
});

test("Stage 70: grouped counts preserve all-branch corruption checking and full clinical scope",()=>{
  const route=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  assert.match(route,/tx\.auditEvent\.groupBy\(/);
  assert.match(route,/by: \["entityId"\]/);
  assert.match(route,/_count: \{ _all: true \}/);
  assert.match(route,/planPolicyQueueDecisionFetch\(draftIds, decisionCounts\)/);
  assert.match(route,/entityId: \{ in: decisionPlan\.safeDraftIds \}/);
  assert.match(route,/take: decisionPlan\.maxRows/);
  assert.match(route,/decisionPlan\.corruptDraftIds\.has\(event\.id\)/);
  assert.match(route,/decided\.length !== \(decisionPlan\.expectedCounts\.get\(event\.id\) \?\? 0\)/);
  assert.match(route,/decided\.some\(d => d\.branchId !== scope\.branchId\)/);
  assert.match(route,/parsePolicyReviewRecord\(/);
  assert.match(route,/d\.actorUserId === batch\.createdByUserId/);
  assert.match(route,/new Set\(parsed\.map\(d => d\.review\?\.domain\)\)/);
  assert.match(route,/new Set\(parsed\.map\(d => d\.actorUserId\)\)/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.doesNotMatch(route,/take: 201/);
  assert.doesNotMatch(route,/decision_limit_exceeded/);
  assert.doesNotMatch(route,/tx\.(?:labTest|priceList|priceListItem|referenceInterval|catalogImportRow)\.(?:create|update|upsert|delete)/);
});
