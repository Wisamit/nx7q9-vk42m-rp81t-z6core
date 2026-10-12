import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { commentTemplateReviewFingerprint, commentTransitionError } from "../src/lib/comment-template-approval.ts";
import { parseCommentRevisionRequest, revisionCode, validateCommentRevisionSource } from "../src/lib/comment-template-revisions.ts";
import { commentReviewBlocker, type ReviewTemplate } from "../src/lib/comment-template-review-queue.ts";

const org=randomUUID(),oldId=randomUUID(),newId=randomUUID(),testId=randomUUID(),componentId=randomUUID();
const source = {
  id:oldId,organizationId:org,scope:"COMPONENT" as const,
  testId,componentId,code:"COMMENT_ORIGINAL",nameEn:"Original",nameAr:"أصلي",
  textEn:"Approved clinical context",textAr:"تعليق معتمد",
  status:"ACTIVE" as const,updatedAt:new Date("2026-10-12T07:00:00.000Z"),
  revisionNumber:1,supersedesTemplateId:null,
};
const input = {
  id:oldId,expectedFingerprint:commentTemplateReviewFingerprint(source),
  reason:"Clinician identified a necessary clinical correction",
  nameEn:"Corrected",nameAr:"مصحح",textEn:"Corrected text",textAr:"النص المصحح",
};

test("Stage 87: immutable clinical revision attestation and content validation",()=>{
  assert.deepEqual(parseCommentRevisionRequest(input),input);
  const fail=(value:unknown,code:string)=>assert.throws(()=>parseCommentRevisionRequest(value),
    (error:unknown)=>!!error && typeof error==="object" && "reason" in error &&
      (error as {reason:unknown}).reason===code);
  fail({...input,expectedFingerprint:"bad"},"comment_template_review_stale");
  fail({...input,reason:"short"},"revision_reason_required");
  fail({...input,textEn:"X".repeat(5001)},"invalid_textEn");
  fail({...input,textAr:"A\u0000B"},"invalid_textAr");
  fail({...input,nameEn:""},"missing_required_fields");
  fail({...input,id:"foreign"},"invalid_revision_parent");
  assert.equal(validateCommentRevisionSource(source,input,commentTemplateReviewFingerprint(source),true),null);
  assert.equal(validateCommentRevisionSource(source,{...input,expectedFingerprint:"a".repeat(64)},
    commentTemplateReviewFingerprint(source),true),"comment_template_review_stale");
  assert.equal(validateCommentRevisionSource(source,{...input,nameEn:source.nameEn,nameAr:source.nameAr,
    textEn:source.textEn,textAr:source.textAr},commentTemplateReviewFingerprint(source),true),
    "comment_revision_no_clinical_change");
  assert.equal(validateCommentRevisionSource(source,input,commentTemplateReviewFingerprint(source),false),
    "comment_template_target_inactive_or_invalid");
  assert.equal(validateCommentRevisionSource({...source,status:"INACTIVE"},input,
    commentTemplateReviewFingerprint(source),true),"revision_requires_active_predecessor");
  assert.equal(revisionCode("TEST",2),"TEST_V2");
  assert.equal(revisionCode("A".repeat(80),15).length,80);
  assert.throws(()=>revisionCode("TEST",1));
});

test("Stage 87: separate clinician approval must explicitly retire approved predecessor",()=>{
  const candidate = {
    ...source,id:newId,status:"INACTIVE" as const,
    revisionNumber:2,supersedesTemplateId:oldId,code:revisionCode(source.code,2),
  };
  const attested={status:"ACTIVE" as const, reason:"Independently reviewed exact revised text",
    expectedFingerprint:commentTemplateReviewFingerprint(candidate),
    confirmation:"APPROVE_REVISION_AND_RETIRE_PREDECESSOR"};
  assert.equal(commentTransitionError(candidate,attested,"author","reviewer",true),null);
  assert.equal(commentTransitionError(candidate,{...attested,confirmation:"APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT"},
    "author","reviewer",true),"comment_template_explicit_approval_required");
  assert.equal(commentTransitionError(candidate,attested,"author","author",true),
    "comment_template_self_approval_forbidden");
  assert.notEqual(commentTemplateReviewFingerprint({...candidate,supersedesTemplateId:null}),
    attested.expectedFingerprint);
  assert.notEqual(commentTemplateReviewFingerprint({...candidate,revisionNumber:4}),
    attested.expectedFingerprint);
  const review:ReviewTemplate={...candidate,
    test:{id:testId,organizationId:org,status:"ACTIVE"},
    component:{id:componentId,testId,status:"ACTIVE"},
    supersedesTemplate:{id:oldId,status:"ACTIVE",revisionNumber:1}};
  assert.equal(commentReviewBlocker(review,"author","reviewer"),null);
  assert.equal(commentReviewBlocker({...review,supersedesTemplate:{...review.supersedesTemplate!,status:"INACTIVE"}},
    "author","reviewer"),"PREDECESSOR_INACTIVE");
  assert.equal(commentReviewBlocker({...review,supersedesTemplate:null},
    "author","reviewer"),"PREDECESSOR_INACTIVE");
});

test("Stage 87: schema/migration/API/entry UI enforce one successor, immutable source and atomic retirement",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261012120000_comment_template_immutable_revisions/migration.sql","utf8");
  const create=readFileSync("src/app/api/clinical-rules/comments/revisions/route.ts","utf8");
  const approve=readFileSync("src/app/api/clinical-rules/comments/route.ts","utf8");
  const queue=readFileSync("src/app/clinical-comments/review/page.tsx","utf8");
  const revisions=readFileSync("src/app/clinical-comments/revisions/page.tsx","utf8");
  const editor=readFileSync("src/components/comment-revision-editor.tsx","utf8");
  assert.match(schema,/supersedesTemplateId String\?\s+@unique/);
  assert.match(migration,/CREATE UNIQUE INDEX/);
  assert.match(migration,/ON DELETE RESTRICT/);
  assert.match(create,/requirePermission\("result_comments\.manage"\)/);
  assert.match(create,/scope\.branch\.organizationId === organizationId/);
  assert.match(create,/FROM result_comment_templates[\s\S]*?FOR UPDATE/);
  assert.match(create,/where: \{ supersedesTemplateId: predecessor\.id \}/);
  assert.match(create,/commentTemplateReviewFingerprint\(predecessor\)/);
  assert.match(create,/status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(create,/RESULT_COMMENT_TEMPLATE_REVISION_CREATED/);
  assert.match(create,/await tx\.auditEvent\.create/);
  assert.match(create,/isolationLevel: "Serializable"/);
  assert.match(approve,/APPROVE_REVISION_AND_RETIRE_PREDECESSOR|commentTransitionError/);
  assert.match(approve,/RESULT_COMMENT_TEMPLATE_SUPERSEDED/);
  assert.match(approve,/where: \{ id: predecessor\.id, organizationId,[\s\S]*?updatedAt: predecessor\.updatedAt/);
  assert.match(approve,/comment_revision_predecessor_superseded/);
  assert.match(approve,/RESULT_COMMENT_TEMPLATE_REVISION_CREATED/);
  assert.match(queue,/RESULT_COMMENT_TEMPLATE_REVISION_CREATED/);
  assert.match(queue,/supersedesTemplateId=\{template\.supersedesTemplateId\}/);
  assert.match(revisions,/where: \{ organizationId, status: "ACTIVE", nextRevision: null/);
  assert.match(editor,/expectedFingerprint: current\.fingerprint/);
  assert.match(editor,/APPROVE_REVISION_AND_RETIRE_PREDECESSOR|separate clinical reviewer|independent clinical reviewer/i);
});
