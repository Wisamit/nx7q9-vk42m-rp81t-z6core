import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  issueSignedPolicyQueueCursor, verifySignedPolicyQueueCursor,
  samePolicyQueueAnchor, POLICY_QUEUE_CURSOR_TTL_MS,
} from "../src/lib/catalog-policy-queue-signed-cursor.ts";
import { decodePolicyQueueCursor, encodePolicyQueueCursor } from "../src/lib/catalog-policy-queue-pagination.ts";

const at = (seconds: number) => new Date(Date.UTC(2026,9,11,10,0,seconds));
const id = (n: number) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12,"0");
const anchor = { occurredAt: at(20), id: id(20) };
const after = { occurredAt: at(12), id: id(12) };
const context = {organizationId:id(1),branchId:id(2),reviewerUserId:id(3),
  secret:"family-lab-test-only-signing-key-".repeat(2)};
const now = Date.UTC(2026,9,11,10,1,0);
const expiresAt = now + POLICY_QUEUE_CURSOR_TTL_MS;
const signed = () => issueSignedPolicyQueueCursor({ ...context, after, anchor, expiresAt });

test("Stage 66: signed cursor round trip is bound to tenant, branch, reviewer and time",()=>{
  const token=signed();
  assert.match(token,/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  assert.deepEqual(verifySignedPolicyQueueCursor(token,context,now),{
    anchor,after,expiresAt,
  });
  assert.equal(token.includes(context.organizationId),false);
  assert.equal(token.includes(context.branchId),false);
  assert.equal(token.includes(context.reviewerUserId),false);
  assert.equal(verifySignedPolicyQueueCursor(null,context,now),null);
  assert.equal(verifySignedPolicyQueueCursor(token,{...context,organizationId:id(9)},now),undefined);
  assert.equal(verifySignedPolicyQueueCursor(token,{...context,branchId:id(9)},now),undefined);
  assert.equal(verifySignedPolicyQueueCursor(token,{...context,reviewerUserId:id(9)},now),undefined);
  assert.equal(verifySignedPolicyQueueCursor(token,{...context,secret:"different-long-secret-".repeat(3)},now),undefined);
  assert.equal(verifySignedPolicyQueueCursor(token,context,expiresAt),undefined);
  assert.equal(verifySignedPolicyQueueCursor(token,context,now-1),undefined);
});

test("Stage 66: tampering, noncanonical tokens, malformed UTF8 and legacy cursors fail closed",()=>{
  const token=signed();
  const [payload,signature]=token.split(".");
  const flipped=(signature[0]==="0" ? "1" : "0")+signature.slice(1);
  assert.equal(verifySignedPolicyQueueCursor(payload+"."+flipped,context,now),undefined);
  const changed=Buffer.from(JSON.stringify({v:2,p:encodePolicyQueueCursor(anchor),
    a:encodePolicyQueueCursor(anchor),e:expiresAt}),"utf8").toString("base64url");
  assert.equal(verifySignedPolicyQueueCursor(changed+"."+signature,context,now),undefined);
  for(const invalid of ["","x","!".repeat(700),payload+".","."+signature,
    payload+"."+signature.toUpperCase(),token+"x",token+".x",
    encodePolicyQueueCursor(after),Buffer.from("{}", "utf8").toString("base64url")+"."+signature,
  ]) assert.equal(verifySignedPolicyQueueCursor(invalid,context,now),undefined,invalid.slice(0,20));
  assert.deepEqual(decodePolicyQueueCursor(encodePolicyQueueCursor(after)),after);
  const futureIssued=issueSignedPolicyQueueCursor({
    ...context,anchor,after,expiresAt:now+POLICY_QUEUE_CURSOR_TTL_MS+1,
  });
  assert.equal(verifySignedPolicyQueueCursor(futureIssued,context,now),undefined);
  const reversed=issueSignedPolicyQueueCursor({
    ...context,anchor:after,after:anchor,expiresAt,
  });
  assert.equal(verifySignedPolicyQueueCursor(reversed,context,now),undefined);
});

test("Stage 66: audit watermark drift is rejected, including same-millisecond new revisions",()=>{
  assert.equal(samePolicyQueueAnchor(anchor,anchor),true);
  assert.equal(samePolicyQueueAnchor(anchor,null),false);
  assert.equal(samePolicyQueueAnchor(anchor,{
    occurredAt:anchor.occurredAt,id:id(21),
  }),false);
  assert.equal(samePolicyQueueAnchor(anchor,{
    occurredAt:at(21),id:anchor.id,
  }),false);
});

test("Stage 66: API rejects reused wrong-user/branch and stale watermark before looking up candidates",()=>{
  const route=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-policy-draft-review-queue.tsx","utf8");
  assert.match(route,/catalogBundleSigningSecret\(process\.env\)/);
  assert.match(route,/policy_queue_key_unavailable/);
  assert.match(route,/reviewerUserId: session\.user\.id/);
  assert.match(route,/branchId: scope\.branchId/);
  assert.match(route,/verifySignedPolicyQueueCursor\(token, signedContext, Date\.now\(\)\)/);
  assert.match(route,/samePolicyQueueAnchor\(cursorState\.anchor, anchor\)/);
  assert.match(route,/policy_queue_cursor_stale/);
  assert.match(route,/policy_queue_cursor_invalid/);
  assert.match(route,/issueSignedPolicyQueueCursor\(/);
  assert.ok(route.indexOf("samePolicyQueueAnchor(")<route.indexOf("const latestEvents ="));
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.match(ui,/policy_queue_cursor_stale/);
  assert.match(ui,/تغيّرت مسودات السياسة أثناء التصفح/);
  assert.match(ui,/Policy drafts changed while paging/);
  assert.match(ui,/setLoaded\(false\)/);
  assert.match(ui,/\[0-9a-f\]\{64\}/);
  assert.doesNotMatch(route,/tx\.(?:labTest|referenceInterval|priceList|catalogImportBatch)\.(?:create|update|upsert|delete)/);
});
