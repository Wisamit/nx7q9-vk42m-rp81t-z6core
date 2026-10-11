import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodePolicyQueueCursor, encodePolicyQueueCursor, policyQueueNextPage,
  POLICY_QUEUE_EVENT_WINDOW, POLICY_QUEUE_ENTRY_LIMIT,
} from "../src/lib/catalog-policy-queue-pagination.ts";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

const t=(n:number)=>new Date(Date.UTC(2026,9,11,10,0,n));
const id=(n:number)=>"aaaaaaaa-aaaa-4aaa-8aaa-"+String(n).padStart(12,"0");
const event=(n:number)=>({occurredAt:t(n%60),id:id(n)});

test("Stage 65: strict canonical opaque keyset cursor, no raw audit or authorization data",()=>{
  const point=event(24);
  const encoded=encodePolicyQueueCursor(point);
  assert.deepEqual(decodePolicyQueueCursor(encoded),point);
  assert.equal(decodePolicyQueueCursor(null),null);
  for(const invalid of [""," ","not-valid?","!".repeat(50),"a".repeat(257),
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({t:"2026-10-11T10:00:02.000Z",i:"INVALID"})).toString("base64url"),
    Buffer.from(JSON.stringify({t:"2026-02-30T10:00:02.000Z",i:id(1)})).toString("base64url"),
    Buffer.from(JSON.stringify({t:"2026-10-11T10:00:02Z",i:id(1)})).toString("base64url"),
    Buffer.from(JSON.stringify({t:"2026-10-11T10:00:02.000Z",i:id(1),scope:"foreign"})).toString("base64url"),
  ]) assert.equal(decodePolicyQueueCursor(invalid),undefined,invalid);
  assert.equal(encoded.includes("approved"),false);
  assert.equal(encoded.includes("branchId"),false);
  assert.equal(encoded.includes("actorUserId"),false);
});

test("Stage 65: return cursor at last examined event when 30 candidates found early",()=>{
  assert.equal(POLICY_QUEUE_EVENT_WINDOW,100);
  assert.equal(POLICY_QUEUE_ENTRY_LIMIT,30);
  const descending=[event(35),event(34),event(33),event(32),event(31)];
  const early=policyQueueNextPage({window:descending,lastScanned:descending[2],overflow:false});
  assert.equal(early.hasMore,true);
  assert.deepEqual(decodePolicyQueueCursor(early.nextCursor),descending[2]);
  const full=policyQueueNextPage({window:descending,lastScanned:descending[4],overflow:false});
  assert.deepEqual(full,{hasMore:false,nextCursor:null});
  const hidden=policyQueueNextPage({window:descending,lastScanned:descending[4],overflow:true});
  assert.equal(hidden.hasMore,true);
  assert.deepEqual(decodePolicyQueueCursor(hidden.nextCursor),descending[4]);
  assert.deepEqual(policyQueueNextPage({window:[],lastScanned:null,overflow:false}),
    {hasMore:false,nextCursor:null});
});

test("Stage 65: same-millisecond audit events paginate by id descending",()=>{
  const now=new Date("2026-10-11T10:00:00.123Z");
  const events=[{occurredAt:now,id:id(3)},{occurredAt:now,id:id(2)},
    {occurredAt:now,id:id(1)}];
  const page=policyQueueNextPage({window:events,lastScanned:events[0],overflow:false});
  assert.equal(page.hasMore,true);
  const cursor=decodePolicyQueueCursor(page.nextCursor);
  assert.ok(cursor);
  const older=events.filter(x=>x.occurredAt < cursor.occurredAt ||
    (x.occurredAt.getTime()===cursor.occurredAt.getTime() && x.id < cursor.id));
  assert.deepEqual(older.map(x=>x.id),[id(2),id(1)]);
});

test("Stage 65: older revision reached through cursor remains ineligible even when newest is outside page",()=>{
  const scope={organizationId:id(11),branchId:id(12),batchId:id(13),
    sourceChecksum:"b".repeat(64),authorUserId:id(14)};
  const proposal=Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const rows=[2,1].map(revision=>({
    id:id(revision),actorUserId:scope.authorUserId,branchId:scope.branchId,
    newValues:createPolicyDraftLedgerEntry(scope,proposal,revision),
  }));
  assert.equal(verifiedPolicyQueueCandidate({...scope,events:rows,candidateEventId:id(1)}),null);
  assert.equal(verifiedPolicyQueueCandidate({...scope,events:rows,candidateEventId:id(2)})?.draft?.revision,2);
});

test("Stage 65: API keyset and client page controls are scoped and fail-closed",()=>{
  const route=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-policy-draft-review-queue.tsx","utf8");
  // Stage 66 additionally binds pagination to reviewer, branch and tenant.
  assert.match(route,/verifySignedPolicyQueueCursor\(token, signedContext, Date\.now\(\)\)/);
  assert.match(route,/params\.keys\(\)/);
  assert.match(route,/occurredAt: \{ lt: cursor\.occurredAt \}/);
  assert.match(route,/occurredAt: cursor\.occurredAt, id: \{ lt: cursor\.id \}/);
  assert.match(route,/POLICY_QUEUE_EVENT_WINDOW \+ 1/);
  assert.match(route,/policyQueueNextPage\(/);
  assert.match(route,/if \(!batchScope\.ok\) continue/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/decision_limit_exceeded/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.doesNotMatch(route,/policy_queue_history_limit_exceeded/);
  assert.doesNotMatch(route,/tx\.(?:labTest|priceList|referenceInterval|catalogImportRow)\.(?:create|update|upsert|delete)/);
  assert.match(ui,/No eligible drafts on this page/);
  assert.match(ui,/لا توجد مسودات قابلة للمراجعة في هذه الصفحة/);
  assert.match(ui,/setNextCursor\(/);
  assert.match(ui,/setHistory\(/);
  assert.match(ui,/Previous/);
  assert.match(ui,/التالي/);
});
