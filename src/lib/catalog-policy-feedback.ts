import {
  parsePolicyReviewRecord, type PolicyReviewDisposition, type PolicyReviewReason,
} from "./catalog-policy-draft-review.ts";
import type { PolicyDraftLedgerEntry } from "./catalog-signatory-policy-draft.ts";

export type PolicyFeedbackDomain = {
  status: "PENDING" | PolicyReviewDisposition;
  reasonCode: PolicyReviewReason | null;
};
export type PolicyReviewFeedback = {
  revision: number;
  domains: { CLINICAL: PolicyFeedbackDomain; FINANCIAL: PolicyFeedbackDomain };
  reviewOnly: true; approved: false; signingEnabled: false;
  activated: false; liveWrites: false;
};
type ReviewEvent = { actorUserId: string | null; newValues: unknown };
const pending = (): PolicyFeedbackDomain => ({ status: "PENDING", reasonCode: null });

/**
 * Author-visible feedback for precisely one policy draft AuditEvent revision.
 * Fail closed on a third review, damaged payload, self review, shared reviewer
 * or duplicate domain. Prior revisions cannot be accidentally counted.
 */
export function policyDraftAuthorFeedback(input: {
  draftEventId: string; draft: PolicyDraftLedgerEntry;
  authorUserId: string; events: readonly ReviewEvent[];
}): PolicyReviewFeedback | null {
  if (input.events.length > 2) return null;
  const domains: PolicyReviewFeedback["domains"] = {
    CLINICAL: pending(), FINANCIAL: pending(),
  };
  const reviewers = new Set<string>();
  const occupied = new Set<string>();
  for (const event of input.events) {
    const review = parsePolicyReviewRecord(event.newValues, {
      draftEventId: input.draftEventId, draft: input.draft,
    });
    if (!review || !event.actorUserId ||
        event.actorUserId === input.authorUserId ||
        reviewers.has(event.actorUserId) || occupied.has(review.domain))
      return null;
    reviewers.add(event.actorUserId);
    occupied.add(review.domain);
    domains[review.domain] = {
      status: review.disposition, reasonCode: review.reasonCode,
    };
  }
  return {
    revision: input.draft.revision, domains,
    reviewOnly: true, approved: false, signingEnabled: false,
    activated: false, liveWrites: false,
  };
}
