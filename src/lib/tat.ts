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
  tatEscalationAfterMinutesSnapshot: number | null;
  tatEscalationRepeatMinutesSnapshot: number | null;
  tatMaxEscalationLevelSnapshot: number | null;
  tatEscalationPermissionCodeSnapshot: string | null;
  tatFirstEscalationAt: Date | null;
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

function validateEscalation(input: {
  afterMinutes: number | null | undefined;
  repeatMinutes: number | null | undefined;
  maxLevel: number | null | undefined;
  permissionCode: string | null | undefined;
}) {
  const configured = input.afterMinutes != null
    || input.repeatMinutes != null
    || input.permissionCode != null
    || (input.maxLevel != null && input.maxLevel !== 1);
  if (!configured) return null;

  if (
    input.afterMinutes == null
    || !Number.isInteger(input.afterMinutes)
    || input.afterMinutes < 0
    || input.afterMinutes > 5_256_000
  ) {
    throw new Error("INVALID_TAT_ESCALATION_AFTER_MINUTES");
  }

  const maxLevel = input.maxLevel ?? 1;
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 10) {
    throw new Error("INVALID_TAT_MAX_ESCALATION_LEVEL");
  }

  if (
    input.repeatMinutes != null
    && (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes <= 0 || input.repeatMinutes > 5_256_000)
  ) {
    throw new Error("INVALID_TAT_ESCALATION_REPEAT_MINUTES");
  }
  if (maxLevel > 1 && input.repeatMinutes == null) {
    throw new Error("TAT_ESCALATION_REPEAT_REQUIRED");
  }

  const permissionCode = input.permissionCode?.trim() || "";
  if (!permissionCode || permissionCode.length > 120 || !/^[a-z0-9._-]+$/i.test(permissionCode)) {
    throw new Error("INVALID_TAT_ESCALATION_PERMISSION");
  }

  return {
    afterMinutes: input.afterMinutes,
    repeatMinutes: input.repeatMinutes ?? null,
    maxLevel,
    permissionCode,
  };
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
      approvalStatus: "APPROVED",
      approvedAt: { not: null },
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
    escalationAfterMinutes?: number | null;
    escalationRepeatMinutes?: number | null;
    maxEscalationLevel?: number | null;
    escalationPermissionCode?: string | null;
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
      tatEscalationAfterMinutesSnapshot: null,
      tatEscalationRepeatMinutesSnapshot: null,
      tatMaxEscalationLevelSnapshot: null,
      tatEscalationPermissionCodeSnapshot: null,
      tatFirstEscalationAt: null,
      tatPolicyId: null,
      tatSnapshotSource: "NOT_CONFIGURED",
    };
  }

  validateTatMinutes(tatMinutes);
  validateAlertBeforeMinutes(options.alertBeforeMinutes, tatMinutes);
  const escalation = validateEscalation({
    afterMinutes: options.escalationAfterMinutes,
    repeatMinutes: options.escalationRepeatMinutes,
    maxLevel: options.maxEscalationLevel,
    permissionCode: options.escalationPermissionCode,
  });

  const tatDueAt = new Date(orderedAt.getTime() + tatMinutes * 60_000);
  const alertBeforeMinutes = options.alertBeforeMinutes ?? null;
  const tatAlertAt = alertBeforeMinutes === null
    ? null
    : new Date(tatDueAt.getTime() - alertBeforeMinutes * 60_000);
  const tatFirstEscalationAt = escalation
    ? new Date(tatDueAt.getTime() + escalation.afterMinutes * 60_000)
    : null;

  return {
    tatMinutesSnapshot: tatMinutes,
    tatClockBasisSnapshot: "ORDERED_AT",
    tatClockStartedAt: orderedAt,
    tatDueAt,
    tatAlertBeforeMinutesSnapshot: alertBeforeMinutes,
    tatAlertAt,
    tatEscalationAfterMinutesSnapshot: escalation?.afterMinutes ?? null,
    tatEscalationRepeatMinutesSnapshot: escalation?.repeatMinutes ?? null,
    tatMaxEscalationLevelSnapshot: escalation?.maxLevel ?? null,
    tatEscalationPermissionCodeSnapshot: escalation?.permissionCode ?? null,
    tatFirstEscalationAt,
    tatPolicyId: options.policyId ?? null,
    tatSnapshotSource: options.source ?? "CATALOG_SNAPSHOT",
  };
}

export function tatEscalationLevelsDue(input: {
  firstEscalationAt: Date | null;
  repeatMinutes: number | null;
  maxLevel: number | null;
  latestLevel: number;
  now: Date;
}) {
  if (!input.firstEscalationAt || !input.maxLevel || input.maxLevel < 1) return [];
  const levels: Array<{ level: number; dueAt: Date }> = [];
  const maxLevel = Math.min(Math.max(Math.floor(input.maxLevel), 1), 10);

  for (let level = Math.max(1, input.latestLevel + 1); level <= maxLevel; level += 1) {
    if (level > 1 && (!input.repeatMinutes || input.repeatMinutes <= 0)) break;
    const dueAt = level === 1
      ? input.firstEscalationAt
      : new Date(input.firstEscalationAt.getTime() + (level - 1) * input.repeatMinutes! * 60_000);
    if (dueAt.getTime() > input.now.getTime()) break;
    levels.push({ level, dueAt });
  }
  return levels;
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
