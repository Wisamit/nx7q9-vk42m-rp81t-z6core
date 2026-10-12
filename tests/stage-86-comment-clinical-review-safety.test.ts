import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseClinicalCommentDraft, ClinicalCommentDraftError } from "../src/lib/comment-template-draft.ts";
import {
  commentReviewBlocker, decodeCommentReviewCursor, encodeCommentReviewCursor,
  reviewedCommentTemplateRow,
} from "../src/lib/comment-template-review-queue.ts";
import type { ReviewTemplate } from "../src/lib/comment-template-review-queue.ts";

const testId = randomUUID(), componentId = randomUUID(), organizationId=randomUUID();
const valid = { code:"BILINGUAL_NOTE",scope:"COMPONENT",testId,componentId,
  nameEn:"Comment",nameAr:"تعليق",textEn:"Check method",textAr:"راجع الطريقة" };
const evidence: ReviewTemplate = {
  id:randomUUID(),organizationId,code:"NOTE",nameEn:"Note",nameAr:"ملاحظة",
  textEn:"Interpretative note",textAr:"نص عربي",scope:"COMPONENT",
  testId,componentId,status:"INACTIVE",updatedAt:new Date("2026-10-12T01:00:00.000Z"),
  test:{id:testId,organizationId,status:"ACTIVE"},
  component:{id:componentId,testId,status:"ACTIVE"},
};
function rejects(input:unknown,code:string){
  assert.throws(()=>parseClinicalCommentDraft(input),
    (e:unknown)=>e instanceof ClinicalCommentDraftError && e.reason===code);
}

test("Stage 86: comment creation requires unambiguous explicit scope, strict bounds and valid mappings",()=>{
  assert.deepEqual(parseClinicalCommentDraft(valid),{...valid});
  rejects({...valid,scope:"INFER"},"invalid_comment_scope");
  rejects({...valid,scope:"TEST"},"test_scope_requires_only_test");
  rejects({...valid,scope:"ORGANIZATION"},"organization_scope_must_not_have_target");
  rejects({...valid,componentId:null},"component_scope_requires_both_targets");
  rejects({...valid,testId:randomUUID().slice(0,8)},"invalid_comment_target_id");
  rejects({...valid,nameEn:""},"missing_required_fields");
  rejects({...valid,textEn:"X".repeat(5001)},"invalid_textEn");
  rejects({...valid,textAr:"A".repeat(5001)},"invalid_textAr");
  rejects({...valid,nameAr:"A".repeat(221)},"invalid_nameAr");
  rejects({...valid,textEn:"A\u0000B"},"invalid_textEn");
  rejects({...valid,code:"bad code!"},"invalid_comment_code");
  rejects({...valid,code:"A".repeat(81)},"invalid_code");
  rejects([],"invalid_request");
  assert.equal(parseClinicalCommentDraft({...valid,scope:"TEST",componentId:null}).componentId,null);
  assert.equal(parseClinicalCommentDraft({...valid,scope:"ORGANIZATION",testId:null,componentId:null}).testId,null);
});

test("Stage 86: only independently reviewable drafts have review action",()=>{
  assert.equal(commentReviewBlocker(evidence,"creator","reviewer"),null);
  assert.equal(reviewedCommentTemplateRow(evidence,"creator","reviewer").canApprove,true);
  assert.equal(commentReviewBlocker(evidence,null,"reviewer"),"CREATOR_UNVERIFIED");
  assert.equal(commentReviewBlocker(evidence,"reviewer","reviewer"),"SELF_APPROVAL");
  assert.equal(commentReviewBlocker({...evidence,test:{...evidence.test!,status:"INACTIVE"}},
    "creator","reviewer"),"TARGET_INACTIVE_OR_INVALID");
  assert.equal(commentReviewBlocker({...evidence,component:{...evidence.component!,status:"INACTIVE"}},
    "creator","reviewer"),"TARGET_INACTIVE_OR_INVALID");
  assert.equal(commentReviewBlocker({...evidence,component:{...evidence.component!,testId:randomUUID()}},
    "creator","reviewer"),"TARGET_INACTIVE_OR_INVALID");
  assert.equal(commentReviewBlocker({...evidence,test:{...evidence.test!,organizationId:randomUUID()}},
    "creator","reviewer"),"TARGET_INACTIVE_OR_INVALID");
  assert.equal(commentReviewBlocker({...evidence,textEn:"  "},"creator","reviewer"),"CONTENT_MISSING");
  assert.equal(commentReviewBlocker({...evidence,scope:"ORGANIZATION",testId:null,componentId:null,test:null,component:null},
    "creator","reviewer"),null);
  assert.equal(reviewedCommentTemplateRow({...evidence,status:"ACTIVE"},"creator","reviewer").canApprove,false);
});

test("Stage 86: review cursor is round-trip strict and rejects malicious or malformed positions",()=>{
  const id=randomUUID(),createdAt=new Date("2026-10-12T01:02:03.456Z");
  assert.deepEqual(decodeCommentReviewCursor(encodeCommentReviewCursor({id,createdAt})),
    {id,createdAt});
  for(const value of ["", "not-a-cursor", "2026-13-01T02:03:04.000Z|"+id,
    "2026-10-12T01:02:03.456Z|other", "2026-10-12T01:02:03.456Z|"+id+"|x",
    "a".repeat(91)]) assert.equal(decodeCommentReviewCursor(value),null);
});

test("Stage 86: read access and review action enforce both permissions, active branch and tenant on server",()=>{
  const page=readFileSync("src/app/clinical-comments/review/page.tsx","utf8");
  const nav=readFileSync("src/components/system-shell.tsx","utf8");
  const route=readFileSync("src/app/api/clinical-rules/comments/route.ts","utf8");
  const manager=readFileSync("src/components/clinical-rules-manager.tsx","utf8");
  assert.match(page,/requirePermission\("clinical_rules\.approve"\)/);
  assert.match(page,/permissions\.has\("result_comments\.manage"\)/);
  assert.match(page,/scope\.branch\.organizationId === session\.user\.organizationId/);
  assert.match(page,/where: \{ organizationId, status: "INACTIVE" \}/);
  assert.match(page,/entityId: \{ in: ids \}/);
  assert.match(page,/creatorById/);
  assert.match(page,/commentReviewBlocker/);
  assert.match(page,/commentTemplateReviewFingerprint\(template\)/);
  assert.match(page,/PAGE_SIZE \+ 1/);
  assert.match(page,/Next 50 drafts/);
  assert.match(nav,/permissionsAll: \["clinical_rules\.approve", "result_comments\.manage"\]/);
  assert.match(nav,/item\.permissionsAll\.every\(code => permissionSet\.has\(code\)\)/);
  assert.match(route,/parseClinicalCommentDraft/);
  assert.match(route,/FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(route,/FROM branches WHERE id = \$\{branchId\}/);
  assert.match(route,/FROM lab_tests WHERE id = \$\{draft\.testId\}/);
  assert.match(route,/FROM test_components WHERE id = \$\{draft\.componentId\}/);
  assert.match(route,/AND test_id = \$\{draft\.testId\} AND status = 'ACTIVE' FOR UPDATE/);
  assert.match(route,/status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(route,/await tx\.auditEvent\.create/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(manager,/different authorized reviewer/);
});
