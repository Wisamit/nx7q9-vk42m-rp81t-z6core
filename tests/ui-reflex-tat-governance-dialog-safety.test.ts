import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Issue #265: Reflex review is a real clinical+financial decision, never native prompt or auto-charge",()=>{
 const source=readFileSync("src/components/reflex-review-panel.tsx","utf8");
 assert.ok(source.includes('import {CrudModal} from "@/components/crud-modal"'));
 assert.ok(source.includes("open={reviewTarget!==null}"));
 assert.ok(source.includes('size="compact"'));
 assert.ok(source.includes('onSubmit={confirmReview}'));
 assert.ok(source.includes('billingAcknowledged:true'));
 assert.ok(source.includes('name="billingAcknowledged" type="checkbox" required'));
 assert.ok(source.includes('billingAcknowledged")!=="on"'));
 assert.ok(source.includes("candidate.invoiceNumber"));
 assert.ok(source.includes("candidate.lineTotal"));
 assert.ok(source.includes("candidate.currency"));
 assert.ok(source.includes("x.orderItemId+\"|\"+x.invoiceLineId===selected[event.id]"));
 assert.ok(source.includes('x.testId===event.targetTestId'));
 assert.ok(source.includes('note.length<10 || note.length>1000'));
 assert.ok(source.includes("setReviewTarget(null)"));
 assert.ok(source.includes("finally{setBusy(\"\");}"));
 assert.doesNotMatch(source,/(?:window\.)?(?:prompt|confirm)\s*\(/);
});

test("Issue #265: TAT approval and retirement keep governed effective-dated policy history",()=>{
 const source=readFileSync("src/components/tat-policy-governance-actions.tsx","utf8");
 assert.ok(source.includes("CrudModal"));
 assert.ok(source.includes('open={review!==null}'));
 assert.ok(source.includes('size="compact"'));
 assert.ok(source.includes('onSubmit={submitReview}'));
 assert.ok(source.includes('review==="APPROVE"&&approvalStatus!=="DRAFT"'));
 assert.ok(source.includes('review==="RETIRE"&&approvalStatus!=="APPROVED"'));
 assert.ok(source.includes('documentedReason.length<10'));
 assert.ok(source.includes('body:JSON.stringify({id,action:decision,reason:documentedReason})'));
 assert.ok(source.includes('approved_tat_policy_overlap'));
 assert.ok(source.includes('Connection interrupted. Review current policy revision before retrying.'));
 assert.doesNotMatch(source,/(?:window\.)?(?:prompt|confirm)\s*\(/);
});
