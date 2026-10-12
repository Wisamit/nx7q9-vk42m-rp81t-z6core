import { createHash } from "node:crypto";

export type InterpretationEvidence = {
  id: string; organizationId: string; orderId: string; revisionNumber: number;
  textEn: string; textAr: string; supersedesCommentId: string | null;
  createdByUserId: string; status: "DRAFT" | "APPROVED" | "REJECTED" | "RETIRED";
  createdAt: Date;
};

export class InterpretationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode = 409) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}
export function parseInterpretationDraft(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InterpretationError("invalid_request",400);
  const b = raw as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" ? b.orderId.trim() : "";
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(orderId)) throw new InterpretationError("invalid_order",400);
  function check(field: "textEn" | "textAr") {
    const value = b[field];
    if (typeof value !== "string" || !value.trim() || value.length > 5000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
      throw new InterpretationError("invalid_" + field,400);
    return value.trim();
  }
  return { orderId, textEn: check("textEn"), textAr: check("textAr") };
}
export function interpretationFingerprint(c: InterpretationEvidence) {
  return createHash("sha256").update(JSON.stringify({
    id:c.id, organizationId:c.organizationId, orderId:c.orderId,
    revisionNumber:c.revisionNumber, textEn:c.textEn, textAr:c.textAr,
    supersedesCommentId:c.supersedesCommentId, createdByUserId:c.createdByUserId,
    status:c.status, createdAt:c.createdAt.toISOString(),
  })).digest("hex");
}
export function parseInterpretationDecision(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InterpretationError("invalid_request",400);
  const b=raw as Record<string,unknown>;
  const id=typeof b.id==="string" ? b.id.trim() : "";
  const expectedFingerprint=typeof b.expectedFingerprint==="string" ? b.expectedFingerprint : "";
  const decision=b.decision==="APPROVE" || b.decision==="REJECT" ? b.decision : null;
  const reason=typeof b.reason==="string" ? b.reason.trim() : "";
  if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) ||
     !/^[a-f0-9]{64}$/.test(expectedFingerprint) || !decision)
    throw new InterpretationError("invalid_decision",400);
  if(reason.length<10 || reason.length>1000 ||
     /[\u0000-\u001f\u007f]/.test(reason))throw new InterpretationError("interpretation_reason_required",400);
  if(decision==="APPROVE" && b.confirmation!=="APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION")
    throw new InterpretationError("explicit_clinical_approval_required",400);
  return {id,expectedFingerprint,decision,reason};
}
export function interpretationReviewError(c: InterpretationEvidence, actorId:string,
  fingerprint:string, predecessor: {id:string;status:string;orderId:string}|null) {
  if(c.status!=="DRAFT")return "interpretation_not_draft";
  if(c.createdByUserId===actorId)return "independent_reviewer_required";
  if(interpretationFingerprint(c)!==fingerprint)return "interpretation_stale";
  if(c.supersedesCommentId &&
    (!predecessor || predecessor.id!==c.supersedesCommentId ||
      predecessor.status!=="APPROVED" || predecessor.orderId!==c.orderId))
    return "interpretation_predecessor_changed";
  return null;
}
