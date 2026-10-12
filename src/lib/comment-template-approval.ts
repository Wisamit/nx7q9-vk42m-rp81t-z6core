import { createHash } from "node:crypto";

export type CommentTemplateEvidence = {
  id: string;
  organizationId: string;
  code: string;
  scope: "ORGANIZATION" | "TEST" | "COMPONENT";
  testId: string | null;
  componentId: string | null;
  nameEn: string;
  nameAr: string | null;
  textEn: string;
  textAr: string | null;
  status: "ACTIVE" | "INACTIVE";
  updatedAt: Date;
};

/** Bind approval to exact tenant, target, both languages and database revision.
 * This digest is an optimistic review token, not an authorization credential. */
export function commentTemplateReviewFingerprint(value: CommentTemplateEvidence): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1, id: value.id, organizationId: value.organizationId,
    code: value.code, scope: value.scope, testId: value.testId,
    componentId: value.componentId, nameEn: value.nameEn,
    nameAr: value.nameAr, textEn: value.textEn, textAr: value.textAr,
    status: value.status, updatedAt: value.updatedAt.toISOString(),
  })).digest("hex");
}

export type CommentTransitionInput = {
  status: "ACTIVE" | "INACTIVE";
  reason: string;
  expectedFingerprint: string;
  confirmation: string | null;
};
export function commentTransitionError(
  template: CommentTemplateEvidence,
  input: CommentTransitionInput,
  creatorUserId: string | null,
  actorUserId: string,
  targetIsActive: boolean,
): string | null {
  if (template.status === input.status) return "comment_template_state_changed";
  if (!/^[a-f0-9]{64}$/.test(input.expectedFingerprint) ||
    input.expectedFingerprint !== commentTemplateReviewFingerprint(template)) {
    return "comment_template_review_stale";
  }
  if (input.reason.length < 10 || input.reason.length > 1000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.reason)) {
    return "comment_template_reason_required";
  }
  if (input.status === "ACTIVE") {
    if (input.confirmation !== "APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT") {
      return "comment_template_explicit_approval_required";
    }
    if (creatorUserId === null) return "comment_template_origin_unverified";
    if (creatorUserId === actorUserId) return "comment_template_self_approval_forbidden";
    if (!template.nameEn.trim() || !template.textEn.trim()) {
      return "comment_template_content_missing";
    }
    if ((template.scope === "ORGANIZATION" && (template.testId || template.componentId)) ||
        (template.scope === "TEST" && (!template.testId || template.componentId)) ||
        (template.scope === "COMPONENT" && (!template.testId || !template.componentId)) ||
        !targetIsActive) {
      return "comment_template_target_inactive_or_invalid";
    }
  }
  return null;
}
