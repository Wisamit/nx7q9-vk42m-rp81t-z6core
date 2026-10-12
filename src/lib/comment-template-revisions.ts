import { ClinicalCommentDraftError, parseClinicalCommentDraft } from "./comment-template-draft.ts";
import type { CommentTemplateEvidence } from "./comment-template-approval.ts";

export type CommentRevisionSource = CommentTemplateEvidence & {
  revisionNumber: number;
  supersedesTemplateId: string | null;
};

export type CommentRevisionRequest = {
  id: string;
  expectedFingerprint: string;
  reason: string;
  nameEn: string;
  nameAr: string | null;
  textEn: string;
  textAr: string | null;
};

export function revisionCode(parentCode: string, nextRevision: number) {
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 2 || nextRevision > 999999)
    throw new ClinicalCommentDraftError("comment_revision_limit_reached");
  const suffix = "_V" + nextRevision;
  return parentCode.slice(0, 80 - suffix.length) + suffix;
}

export function parseCommentRevisionRequest(value: unknown): CommentRevisionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClinicalCommentDraftError("invalid_request");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[a-f0-9-]{36}$/i.test(row.id))
    throw new ClinicalCommentDraftError("invalid_revision_parent");
  if (typeof row.expectedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.expectedFingerprint))
    throw new ClinicalCommentDraftError("comment_template_review_stale");
  if (typeof row.reason !== "string" ||
    row.reason.trim().length < 10 || row.reason.trim().length > 1000 ||
    /[\u0000-\u001F\u007F]/.test(row.reason)) {
    throw new ClinicalCommentDraftError("revision_reason_required");
  }
  const content = parseClinicalCommentDraft({
    scope: "ORGANIZATION",
    code: "REVIEW", nameEn: row.nameEn, nameAr: row.nameAr,
    textEn: row.textEn, textAr: row.textAr,
  });
  return { id: row.id, expectedFingerprint: row.expectedFingerprint,
    reason: row.reason.trim(), nameEn: content.nameEn,
    nameAr: content.nameAr, textEn: content.textEn, textAr: content.textAr };
}

export function validateCommentRevisionSource(
  source: CommentRevisionSource,
  request: CommentRevisionRequest,
  fingerprint: string,
  targetActive: boolean,
): string | null {
  if (source.status !== "ACTIVE") return "revision_requires_active_predecessor";
  if (fingerprint !== request.expectedFingerprint) return "comment_template_review_stale";
  if (!targetActive) return "comment_template_target_inactive_or_invalid";
  if (source.nameEn === request.nameEn && source.nameAr === request.nameAr &&
    source.textEn === request.textEn && source.textAr === request.textAr) {
    return "comment_revision_no_clinical_change";
  }
  return null;
}
