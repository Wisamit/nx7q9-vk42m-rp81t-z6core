import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  commentTemplateReviewFingerprint, commentTransitionError, type CommentTemplateEvidence,
} from "../src/lib/comment-template-approval.ts";

const baseline: CommentTemplateEvidence = {
  id: "template-85", organizationId: "org-one", code: "CLINICAL_NOTE",
  scope: "COMPONENT", testId: "test-one", componentId: "component-one",
  nameEn: "Clinical note", nameAr: "تعليق", textEn: "Clinical reviewed note",
  textAr: "مراجعة سريرية", status: "INACTIVE",
  updatedAt: new Date("2026-10-12T00:00:00.000Z"),
};
const valid = {
  status: "ACTIVE" as const, reason: "Reviewed clinical text and exact target",
  expectedFingerprint: commentTemplateReviewFingerprint(baseline),
  confirmation: "APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT",
};
test("Stage 85: content, tenant, clinical links and revision are bound to the approval fingerprint",()=>{
  for(const changes of [
    {organizationId:"other-org"}, {textEn:"Altered"}, {textAr:"نص مختلف"},
    {testId:"other-test"}, {componentId:"other-component"}, {scope:"TEST" as const},
    {nameAr:"اسم آخر"}, {status:"ACTIVE" as const},
    {updatedAt:new Date("2026-10-12T00:00:01.000Z")},
  ]) assert.notEqual(
    commentTemplateReviewFingerprint({...baseline,...changes}),
    valid.expectedFingerprint,JSON.stringify(changes),
  );
  assert.equal(commentTransitionError(baseline,valid,"author","approver",true),null);
  assert.equal(commentTransitionError(baseline,{...valid,expectedFingerprint:"a".repeat(64)},
    "author","approver",true),"comment_template_review_stale");
});

test("Stage 85: no self approval, unknown provenance, missing authority or linked inactive targets",()=>{
  assert.equal(commentTransitionError(baseline,valid,"approver","approver",true),
    "comment_template_self_approval_forbidden");
  assert.equal(commentTransitionError(baseline,valid,null,"approver",true),
    "comment_template_origin_unverified");
  assert.equal(commentTransitionError(baseline,valid,"author","approver",false),
    "comment_template_target_inactive_or_invalid");
  assert.equal(commentTransitionError(baseline,{...valid,confirmation:null},"author","approver",true),
    "comment_template_explicit_approval_required");
  assert.equal(commentTransitionError(baseline,{...valid,reason:"short"},"author","approver",true),
    "comment_template_reason_required");
  assert.equal(commentTransitionError({...baseline,status:"ACTIVE"},
    {...valid,expectedFingerprint:commentTemplateReviewFingerprint({...baseline,status:"ACTIVE"})},
    "author","approver",true),"comment_template_state_changed");
  for(const bad of [
    {...baseline,scope:"ORGANIZATION" as const},
    {...baseline,scope:"TEST" as const},
    {...baseline,componentId:null},
  ]) assert.equal(commentTransitionError(bad,{
    ...valid,expectedFingerprint:commentTemplateReviewFingerprint(bad),
  },"author","approver",true),"comment_template_target_inactive_or_invalid");
  const retired = {...baseline,status:"ACTIVE" as const};
  assert.equal(commentTransitionError(retired,{
    status:"INACTIVE",reason:"Retired clinical comment safely",
    expectedFingerprint:commentTemplateReviewFingerprint(retired),confirmation:null,
  },null,"author",false),null);
});

test("Stage 85: API enforces approval permission and active branch, transaction locks, CAS and durable audit",()=>{
  const route=readFileSync("src/app/api/clinical-rules/comments/route.ts","utf8");
  const page=readFileSync("src/app/clinical-rules/page.tsx","utf8");
  const ui=readFileSync("src/components/comment-template-status-button.tsx","utf8");
  assert.match(route,/permissions\.has\("clinical_rules\.approve"\)/);
  assert.match(route,/scope\.branch\.organizationId === session\.user\.organizationId/);
  assert.match(route,/FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(route,/FROM result_comment_templates[\s\S]*?FOR UPDATE/);
  assert.match(route,/FROM lab_tests[\s\S]*?FOR UPDATE/);
  assert.match(route,/FROM test_components[\s\S]*?FOR UPDATE/);
  assert.match(route,/where: \{ id, organizationId, status: template\.status, updatedAt: template\.updatedAt \}/);
  assert.match(route,/LEGACY_MASTER_RECORD_CREATED/);
  assert.match(route,/RESULT_COMMENT_TEMPLATE_CREATED/);
  assert.match(route,/RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED/);
  assert.match(route,/await tx\.auditEvent\.create/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(route,/status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(page,/commentTemplateReviewFingerprint\(template\)/);
  assert.match(page,/permissions\.has\("result_comments\.manage"\) && permissions\.has\("clinical_rules\.approve"\)/);
  assert.match(page,/template\.textAr/);
  assert.match(ui,/APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT/);
  assert.match(ui,/expectedFingerprint: fingerprint/);
  assert.match(ui,/if \(pending\.current\) return/);
});
