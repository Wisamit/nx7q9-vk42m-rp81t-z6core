import {
  readPolicyDraftLedgerEntry, type PolicyDraftLedgerEntry,
} from "./catalog-signatory-policy-draft.ts";

export const POLICY_DRAFT_HISTORY_LIMIT = 1000;

type DraftEvent = {
  id: string; actorUserId: string | null; newValues: unknown;
};

export type VerifiedPolicyDraftHistory = {
  latestEventId: string | null;
  draft: PolicyDraftLedgerEntry | null;
  revisionCount: number;
};

/**
 * Fail closed on every malformed, omitted, duplicated, foreign-actor or
 * checksum-divergent policy draft revision, not only the newest row.
 * Events must be ordered by occurredAt DESC, id DESC, exactly as all readers
 * currently determine the latest draft. Revision ordering is validated
 * independently to tolerate equal-millisecond audit timestamps.
 *
 * This detects structural audit corruption, NOT an authenticated signature.
 */
export function verifyPolicyDraftHistory(input: {
  events: readonly DraftEvent[];
  organizationId: string; batchId: string; branchId: string;
  sourceChecksum: string; authorUserId: string;
}): VerifiedPolicyDraftHistory | null {
  const { events, organizationId, batchId, branchId, sourceChecksum, authorUserId } = input;
  if (events.length > POLICY_DRAFT_HISTORY_LIMIT) return null;
  if (!events.length) return { latestEventId: null, draft: null, revisionCount: 0 };
  const revisions = new Map<number, { id: string; draft: PolicyDraftLedgerEntry }>();
  const eventIds = new Set<string>();
  for (const event of events) {
    if (!event.id || eventIds.has(event.id) ||
        !event.actorUserId || event.actorUserId !== authorUserId)
      return null;
    const draft = readPolicyDraftLedgerEntry(event.newValues, {
      organizationId, batchId, branchId, sourceChecksum,
    });
    if (!draft || revisions.has(draft.revision)) return null;
    eventIds.add(event.id);
    revisions.set(draft.revision, { id: event.id, draft });
  }
  for (let revision = 1; revision <= events.length; revision++) {
    if (!revisions.has(revision)) return null;
  }
  const current = revisions.get(events.length);
  // A newly appended revision must be the most recent audit entry. Detect
  // timestamp/order collisions rather than silently expose a stale version.
  if (!current || current.id !== events[0].id) return null;
  return {
    latestEventId: current.id,
    draft: current.draft,
    revisionCount: events.length,
  };
}

/**
 * Historical audit events for one batch must be read tenant-wide, not
 * prefiltered by branch. Otherwise a later wrong-branch event could be
 * hidden and an older valid revision incorrectly treated as current.
 * The branch gate applies to EVERY revision before digest/history checks.
 */
export function verifyBranchScopedPolicyDraftHistory(input: {
  events: readonly (DraftEvent & { branchId: string | null })[];
  organizationId: string; batchId: string; branchId: string;
  sourceChecksum: string; authorUserId: string;
}): VerifiedPolicyDraftHistory | null {
  if (input.events.some(event => event.branchId !== input.branchId)) return null;
  return verifyPolicyDraftHistory(input);
}

/**
 * Read review comments across all branch assignments for the same draft ID
 * before validating them. A foreign-branch audit must never vanish from
 * the reviewer's conflict and distinct-reviewer checks.
 */
export function policyAuditBranchesMatch(
  events: readonly { branchId: string | null }[], branchId: string,
): boolean {
  return events.every(event => event.branchId === branchId);
}
