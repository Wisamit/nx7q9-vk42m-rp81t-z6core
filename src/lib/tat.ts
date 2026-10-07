import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type TatSnapshotSource = "CATALOG_SNAPSHOT" | "SLA_POLICY" | "NOT_CONFIGURED" | "MIGRATED_BASELINE";
export type TatClockBasis = "ORDERED_AT";
export type TatPriority = "ROUTINE" | "URGENT" | "STAT";

export type TatPolicyCandidate = {
  id: string;
  branchId: string | null;
  priority: TatPriority | null;
  tatMinutes: number;
  alertBeforeMinutes: number | null;
  effectiveFrom: Date;
};

export type OrderItemTatSnapshot = {
  tatMinutesSnapshot: number | null;
  tatClockBasisSnapshot: TatClockBasis | null;
  tatClockStartedAt: Date | null;
  tatDueAt: Date | null;
  tatAlertBeforeMinutesSnapshot: number | null;
  tatAlertAt: Date | null;
  tatPolicyId: string | null;
  tatSnapshotSource: TatSnapshotSource;
};

function validateTatMinutes(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 5_256_000) {
    throw new Error("INVALID_TAT_MINUTES");
  }
}

function validateAlertBeforeMinutes(value: number | null | undefined, tatMinutes: number) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 0 || value > tatMinutes) {
    throw new Error("INVALID_TAT_ALERT_BEFORE_MINUTES");
  }
}

export function tatPolicyMatches(
  policy: TatPolicyCandidate,
  input: { branchId: string; priority: TatPriority },
) {
  if (policy.branchId !== null && policy.branchId !== input.branchId) return false;
  if (policy.priority !== null && policy.priority !== input.priority) return false;
  return true;
}

export function tatPolicySpecificityScore(
  policy: TatPolicyCandidate,
  input: { branchId: string; priority: TatPriority },
) {
  let score = 0;
  if (policy.branchId === input.branchId) score += 2;
  if (policy.priority === input.priority) score += 1;
  return score;
}

export function selectBestTatPolicy<T extends TatPolicyCandidate>(
  policies: T[],
  input: { branchId: string; priority: TatPriority },
) {
  return policies
    .filter(policy => tatPolicyMatches(policy, input))
    .map(policy => ({ policy, score: tatPolicySpecificityScore(policy, input) }))
    .sort((a, b) =>
      b.score - a.score ||
      b.policy.effectiveFrom.getTime() - a.policy.effectiveFrom.getTime() ||
      a.policy.id.localeCompare(b.policy.id)
    )[0]?.policy ?? null;
}

export async function resolveTatPolicy(
  db: DbClient,
  input: {
    testId: string;
    branchId: string;
    priority: TatPriority;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();
  const policies = await db.testTatPolicy.findMany({
    where: {
      testId: input.testId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
        { OR: [{ branchId: null }, { branchId: input.branchId }] },
        { OR: [{ priority: null }, { priority: input.priority }] },
      ],
    },
  });

  return selectBestTatPolicy(policies, input);
}

export function buildOrderItemTatSnapshot(
  tatMinutes: number | null | undefined,
  orderedAt: Date,
  options: {
    source?: Exclude<TatSnapshotSource, "NOT_CONFIGURED" | "MIGRATED_BASELINE">;
    policyId?: string | null;
    alertBeforeMinutes?: number | null;
  } = {},
): OrderItemTatSnapshot {
  if (tatMinutes == null) {
    return {
      tatMinutesSnapshot: null,
      tatClockBasisSnapshot: null,
      tatClockStartedAt: null,
      tatDueAt: null,
      tatAlertBeforeMinutesSnapshot: null,
      tatAlertAt: null,
      tatPolicyId: null,
      tatSnapshotSource: "NOT_CONFIGURED",
    };
  }

  validateTatMinutes(tatMinutes);
  validateAlertBeforeMinutes(options.alertBeforeMinutes, tatMinutes);

  const tatDueAt = new Date(orderedAt.getTime() + tatMinutes * 60_000);
  const alertBeforeMinutes = options.alertBeforeMinutes ?? null;
  const tatAlertAt = alertBeforeMinutes === null
    ? null
    : new Date(tatDueAt.getTime() - alertBeforeMinutes * 60_000);

  return {
    tatMinutesSnapshot: tatMinutes,
    tatClockBasisSnapshot: "ORDERED_AT",
    tatClockStartedAt: orderedAt,
    tatDueAt,
    tatAlertBeforeMinutesSnapshot: alertBeforeMinutes,
    tatAlertAt,
    tatPolicyId: options.policyId ?? null,
    tatSnapshotSource: options.source ?? "CATALOG_SNAPSHOT",
  };
}

export type TatWorkState = "NO_TAT" | "PENDING" | "DUE_SOON" | "OVERDUE" | "COMPLETE";

export function tatWorkState(
  dueAt: Date | null,
  itemStatus: string,
  now: Date,
  alertAt: Date | null = null,
): TatWorkState {
  if (["VERIFIED", "CANCELLED"].includes(itemStatus)) return "COMPLETE";
  if (!dueAt) return "NO_TAT";
  if (dueAt.getTime() < now.getTime()) return "OVERDUE";
  if (alertAt && alertAt.getTime() <= now.getTime()) return "DUE_SOON";
  return "PENDING";
}

export function tatRemainingMinutes(dueAt: Date | null, now: Date) {
  if (!dueAt) return null;
  return Math.ceil((dueAt.getTime() - now.getTime()) / 60_000);
}
