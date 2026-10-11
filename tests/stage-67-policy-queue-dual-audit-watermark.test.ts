import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  issueSignedPolicyQueueCursor, verifySignedPolicyQueueCursor,
  samePolicyQueueAuditWatermark, POLICY_QUEUE_CURSOR_TTL_MS,
  type PolicyQueueAuditWatermark,
} from "../src/lib/catalog-policy-queue-signed-cursor.ts";

const id=(n:number)=>"c0000000-0000-4000-8000-"+String(n).padStart(12,"0");
const at=(ms:number)=>new Date(1791712800000+ms);
const anchor={id:id(9),occurredAt:at(2000)};
const after={id:id(2),occurredAt:at(1000)};
const review={id:id(8),occurredAt:at(3000)};
const context={organizationId:id(1),branchId:id(2),
  reviewerUserId:id(3),secret:"stage-67-test-only-cursor-secret".repeat(2)};
const now=1791712810000;
const payload=(reviewWatermark:PolicyQueueAuditWatermark={latest:null,count:0})=>
  ({...context,anchor,after,draftCount:2,reviewWatermark,
    expiresAt:now+POLICY_QUEUE_CURSOR_TTL_MS});

test("Stage 67: valid version-three token binds count and both audit activity classes",()=>{
  for(const water of [{latest:null,count:0},{latest:review,count:1}]){
    const input=payload(water);
    const token=issueSignedPolicyQueueCursor(input);
    assert.ok(token.length<=768);
    const verified=verifySignedPolicyQueueCursor(token,context,now);
    assert.deepEqual(verified,{
      anchor,after,draftCount:2,reviewWatermark:water,expiresAt:input.expiresAt,
    });
    assert.ok(!token.includes(context.reviewerUserId));
    assert.ok(!token.includes(context.branchId));
    assert.ok(!token.includes(context.organizationId));
    assert.equal(verifySignedPolicyQueueCursor(token,{...context,branchId:id(20)},now),undefined);
    assert.equal(verifySignedPolicyQueueCursor(token,{...context,reviewerUserId:id(21)},now),undefined);
    assert.equal(verifySignedPolicyQueueCursor(token,context,input.expiresAt),undefined);
  }
});

test("Stage 67: appended review invalidates page even if drafts are unchanged",()=>{
  const previous={latest:null,count:0};
  const current={latest:review,count:1};
  assert.equal(samePolicyQueueAuditWatermark(previous,current),false);
  assert.equal(samePolicyQueueAuditWatermark(current,current),true);
  assert.equal(samePolicyQueueAuditWatermark(current,{latest:review,count:2}),false);
  assert.equal(samePolicyQueueAuditWatermark(current,{latest:null,count:1}),false);
  assert.equal(samePolicyQueueAuditWatermark(previous,{latest:review,count:0}),false);
  assert.equal(samePolicyQueueAuditWatermark(previous,{latest:null,count:1}),false);
});

test("Stage 67: same-millisecond lower ID or backdated append cannot evade count watermark",()=>{
  const prior={latest:anchor,count:7};
  const tie={id:id(8),occurredAt:anchor.occurredAt};
  const backdated={id:id(7),occurredAt:at(5)};
  for(const added of [tie,backdated]){
    const max=added.occurredAt.getTime()>anchor.occurredAt.getTime() ||
      (added.occurredAt.getTime()===anchor.occurredAt.getTime() && added.id>anchor.id)
      ? added : anchor;
    assert.deepEqual(max,anchor);
    assert.equal(samePolicyQueueAuditWatermark(prior,{latest:max,count:8}),false);
  }
  assert.equal(samePolicyQueueAuditWatermark(prior,{latest:anchor,count:7}),true);
});

test("Stage 67: malformed count/position signatures and legacy v2 tokens fail closed",()=>{
  assert.throws(()=>issueSignedPolicyQueueCursor({...payload(),draftCount:0}),
    /policy_queue_cursor_invalid/);
  assert.throws(()=>issueSignedPolicyQueueCursor({...payload(),draftCount:-1}),
    /policy_queue_cursor_invalid/);
  assert.throws(()=>issueSignedPolicyQueueCursor({...payload(),reviewWatermark:{
    latest:review,count:0,
  }}),/policy_queue_cursor_invalid/);
  assert.throws(()=>issueSignedPolicyQueueCursor({...payload(),reviewWatermark:{
    latest:null,count:1,
  }}),/policy_queue_cursor_invalid/);
  const token=issueSignedPolicyQueueCursor(payload({latest:review,count:1}));
  const [raw,hmac]=token.split(".");
  const malicious=Buffer.from(JSON.stringify({v:3,p:"bad",a:"bad",dn:1,
    rp:null,rn:0,e:now+1000}),"utf8").toString("base64url");
  assert.equal(verifySignedPolicyQueueCursor(malicious+"."+hmac,context,now),undefined);
  const flipped=(hmac[0]==="f"?"e":"f")+hmac.slice(1);
  assert.equal(verifySignedPolicyQueueCursor(raw+"."+flipped,context,now),undefined);
  const v2=Buffer.from(JSON.stringify({v:2,p:"bad",a:"bad",
    e:now+1000}),"utf8").toString("base64url");
  assert.equal(verifySignedPolicyQueueCursor(v2+"."+hmac,context,now),undefined);
});

test("Stage 67: all current scopes, both latest and counts, block stale pages before candidate scan",()=>{
  const route=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  const cursor=readFileSync("src/lib/catalog-policy-queue-signed-cursor.ts","utf8");
  const ui=readFileSync("src/components/catalog-policy-draft-review-queue.tsx","utf8");
  assert.match(route,/reviewerUserId: session\.user\.id/);
  assert.match(route,/branchId: scope\.branchId/);
  assert.match(route,/tx\.auditEvent\.count\(\{ where: draftWhere \}\)/);
  assert.match(route,/tx\.auditEvent\.count\(\{ where: reviewWhere \}\)/);
  assert.match(route,/CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED/);
  assert.match(route,/CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED/);
  assert.match(route,/cursorState\.draftCount !== draftCount/);
  assert.match(route,/samePolicyQueueAuditWatermark\(cursorState\.reviewWatermark, reviewWatermark\)/);
  assert.ok(route.indexOf("samePolicyQueueAuditWatermark(cursorState.reviewWatermark") <
    route.indexOf("const latestEvents ="));
  assert.match(route,/policy_queue_cursor_stale/);
  assert.match(route,/issueSignedPolicyQueueCursor\(/);
  assert.match(route,/draftCount, reviewWatermark/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.match(ui,/Policy drafts or reviewer decisions changed while paging/);
  assert.match(ui,/تغيّرت مسودات السياسة أو قرارات المراجعة أثناء التصفح/);
  assert.match(ui,/setLoaded\(false\)/);
  assert.match(cursor,/cursor\/v3/);
  assert.doesNotMatch(route,/tx\.(?:labTest|referenceInterval|priceList|catalogImportBatch)\.(?:create|update|upsert|delete)/);
});
