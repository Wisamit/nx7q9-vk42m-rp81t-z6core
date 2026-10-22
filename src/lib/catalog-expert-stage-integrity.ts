import {
  qualifiedIndependentReviewSource, verifyReviewStageEvidence,
  type ReviewStageEvidenceContext, type ReviewStageEvidenceBatchMetadata,
} from "./catalog-review-stage-evidence.ts";

/**
 * Live observation tokens do not by themselves authenticate persisted DRAFT
 * rows. Independent expert inspection and disposition must verify the
 * exact staged v2 evidence envelope and original source qualification.
 */
export function verifyIndependentExpertStage(input: {
  context: ReviewStageEvidenceContext;
  metadata: ReviewStageEvidenceBatchMetadata | null;
  seal: unknown;
  secret: string | null;
}): { ok: true } | {
  ok: false;
  error: "expert_staged_evidence_integrity_error" | "expert_source_not_qualified";
} {
  if (!input.metadata || !verifyReviewStageEvidence({
    ...input.context, batchMetadata: input.metadata,
  }, input.seal, input.secret))
    return { ok: false, error: "expert_staged_evidence_integrity_error" };
  if (!qualifiedIndependentReviewSource(input.metadata))
    return { ok: false, error: "expert_source_not_qualified" };
  return { ok: true };
}
