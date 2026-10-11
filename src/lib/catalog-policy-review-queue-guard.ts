import {
  verifyPolicyDraftHistory, type VerifiedPolicyDraftHistory,
} from "./catalog-policy-draft-history.ts";

/**
 * The queue may advertise a candidate only if the entire historical chain
 * matches its latest visible AuditEvent. This deliberately loads all actors:
 * filtering a later rogue actor could resurrect a superseded proposal.
 *
 * This is a discovery gate; independent preflight and POST perform their own
 * fresh tenant-locked history and live-master checks before showing any choices.
 */
export function verifiedPolicyQueueCandidate(input: {
  events: readonly { id: string; actorUserId: string | null; newValues: unknown }[];
  candidateEventId: string;
  organizationId: string; branchId: string; batchId: string;
  sourceChecksum: string; authorUserId: string;
}): VerifiedPolicyDraftHistory | null {
  const history = verifyPolicyDraftHistory(input);
  if (!history || !history.draft ||
      history.latestEventId !== input.candidateEventId) return null;
  return history;
}
