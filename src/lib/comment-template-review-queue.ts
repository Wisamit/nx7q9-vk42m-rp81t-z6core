import { commentTemplateReviewFingerprint, type CommentTemplateEvidence } from "./comment-template-approval.ts";

export type ReviewTemplate = CommentTemplateEvidence & {
  test?: { id: string; organizationId: string; status: "ACTIVE" | "INACTIVE" } | null;
  component?: { id: string; testId: string; status: "ACTIVE" | "INACTIVE" } | null;
  supersedesTemplate?: { id: string; status: "ACTIVE" | "INACTIVE"; revisionNumber: number } | null;
};

export type ReviewBlocker =
  | "CREATOR_UNVERIFIED" | "SELF_APPROVAL" | "TARGET_INACTIVE_OR_INVALID" | "CONTENT_MISSING"
  | "PREDECESSOR_INACTIVE";

export function commentReviewBlocker(
  template: ReviewTemplate, creatorId: string | null, reviewerId: string,
): ReviewBlocker | null {
  if (creatorId === null) return "CREATOR_UNVERIFIED";
  if (creatorId === reviewerId) return "SELF_APPROVAL";
  if (!template.nameEn.trim() || !template.textEn.trim()) return "CONTENT_MISSING";
  if (template.supersedesTemplateId && (
    template.supersedesTemplate?.id !== template.supersedesTemplateId ||
    template.supersedesTemplate.status !== "ACTIVE" ||
    template.supersedesTemplate.revisionNumber + 1 !== template.revisionNumber
  )) return "PREDECESSOR_INACTIVE";
  const targetIsActive = template.scope === "ORGANIZATION"
    ? !template.testId && !template.componentId
    : template.scope === "TEST"
      ? Boolean(template.testId && !template.componentId &&
        template.test?.id === template.testId &&
        template.test.organizationId === template.organizationId &&
        template.test.status === "ACTIVE")
      : Boolean(template.testId && template.componentId &&
        template.test?.id === template.testId &&
        template.test.organizationId === template.organizationId &&
        template.test.status === "ACTIVE" &&
        template.component?.id === template.componentId &&
        template.component.testId === template.testId &&
        template.component.status === "ACTIVE");
  return targetIsActive ? null : "TARGET_INACTIVE_OR_INVALID";
}

/** Stable, strictly parsed keyset cursor, not a tenant or permission token. */
export function decodeCommentReviewCursor(value: string | undefined | null) {
  if (!value || value.length > 90) return null;
  const parts = value.split("|");
  if (parts.length !== 2 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(parts[0]) ||
    !/^[a-f0-9-]{36}$/i.test(parts[1])) return null;
  const date = new Date(parts[0]);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== parts[0]) return null;
  return { createdAt: date, id: parts[1] };
}

export function encodeCommentReviewCursor(value: { createdAt: Date; id: string }) {
  return `${value.createdAt.toISOString()}|${value.id}`;
}

export function reviewedCommentTemplateRow<T extends CommentTemplateEvidence>(
  template: T, creatorId: string | null, reviewerId: string,
) {
  const blocker = commentReviewBlocker(template, creatorId, reviewerId);
  return {
    ...template, reviewFingerprint: commentTemplateReviewFingerprint(template),
    reviewBlocker: blocker, canApprove: template.status === "INACTIVE" && !blocker,
  };
}
