import { matchesCatalogDriftObservation } from "./catalog-drift-triage.ts";
import { validExpertDisposition, type ExpertDisposition } from "./catalog-expert-disposition.ts";

export type FindingLifecycle =
  | "UNFLAGGED"
  | "AWAITING_EXPERT"
  | "EXPERT_CONFIRMED"
  | "RETURNED_FOR_CORRECTION"
  | "STALE_REVIEW_REQUIRED";

export type FindingState = {
  status: FindingLifecycle;
  canRefer: boolean;
  latestDisposition: ExpertDisposition | null;
  awaitingFreshEvidence: boolean;
};

export type LatestFinding = {
  evidenceToken: unknown;
  decision: unknown;
  currentObservation: string;
};

/**
 * Only actual Stage 53 flags and Stage 54 audit decisions qualify.
 * A historical decision is not a permanent approval. Changed clinical/price
 * evidence makes it stale and explicitly requires a new human triage.
 */
export function resolveFindingLifecycle(input: LatestFinding | null): FindingState {
  if (!input) {
    return {
      status: "UNFLAGGED", canRefer: true,
      latestDisposition: null, awaitingFreshEvidence: false,
    };
  }
  const existingDisposition = validExpertDisposition(input.decision) ? input.decision : null;
  const fresh = matchesCatalogDriftObservation(
    input.evidenceToken, input.currentObservation
  );
  if (!fresh) {
    return {
      status: "STALE_REVIEW_REQUIRED", canRefer: true,
      latestDisposition: existingDisposition, awaitingFreshEvidence: true,
    };
  }
  if (existingDisposition === "CONFIRM_FINDING") {
    return {
      status: "EXPERT_CONFIRMED", canRefer: false,
      latestDisposition: existingDisposition, awaitingFreshEvidence: false,
    };
  }
  if (existingDisposition === "RETURN_FOR_CORRECTION") {
    return {
      status: "RETURNED_FOR_CORRECTION", canRefer: false,
      latestDisposition: existingDisposition, awaitingFreshEvidence: false,
    };
  }
  return {
    status: "AWAITING_EXPERT", canRefer: false,
    latestDisposition: null, awaitingFreshEvidence: false,
  };
}

/**
 * Classify potential new triage safely. Same observation cannot be
 * re-flagged with a new reason to bypass a completed independent decision.
 */
export function triageResubmission(
  existing: LatestFinding | null,
  requestedReason: string,
  existingReason: unknown,
): "NEW_EVIDENCE" | "ALREADY_PENDING" | "ALREADY_FLAGGED" | "DECIDED" {
  const lifecycle = resolveFindingLifecycle(existing);
  if (!existing || lifecycle.status === "STALE_REVIEW_REQUIRED") return "NEW_EVIDENCE";
  if (lifecycle.status === "AWAITING_EXPERT") {
    return requestedReason === existingReason ? "ALREADY_FLAGGED" : "ALREADY_PENDING";
  }
  return "DECIDED";
}
