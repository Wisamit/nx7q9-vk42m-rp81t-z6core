/**
 * Decisions are scoped by one draft AuditEvent id, never by the number
 * of decisions across the whole queue page. At most two distinct, independent
 * procedural domains may be recorded for a draft. A poisoned draft with 3+
 * records is hidden without starving unrelated drafts on the same page.
 *
 * A grouped count is only a bounded discovery hint; subsequent decision
 * payloads, authors, domains, and current branch are validated independently.
 */
export const POLICY_QUEUE_REVIEWS_PER_DRAFT = 2;

export type PolicyQueueDecisionCount = {
  entityId: string;
  _count: { _all: number };
};

export function planPolicyQueueDecisionFetch(
  draftIds: readonly string[],
  counts: readonly PolicyQueueDecisionCount[],
): {
  safeDraftIds: string[];
  corruptDraftIds: ReadonlySet<string>;
  expectedCounts: ReadonlyMap<string, number>;
  maxRows: number;
} | null {
  const all = new Set(draftIds);
  if (all.size !== draftIds.length) return null;
  const expectedCounts = new Map<string, number>();
  for (const count of counts) {
    if (!all.has(count.entityId) || expectedCounts.has(count.entityId) ||
        !Number.isSafeInteger(count._count._all) || count._count._all < 1)
      return null;
    expectedCounts.set(count.entityId, count._count._all);
  }
  const corruptDraftIds = new Set(draftIds.filter(id =>
    (expectedCounts.get(id) ?? 0) > POLICY_QUEUE_REVIEWS_PER_DRAFT));
  const safeDraftIds = draftIds.filter(id => !corruptDraftIds.has(id));
  return {
    safeDraftIds,
    corruptDraftIds,
    expectedCounts,
    // A sentinel read detects inconsistent snapshot or query corruption.
    maxRows: safeDraftIds.length * POLICY_QUEUE_REVIEWS_PER_DRAFT + 1,
  };
}
