import type { Prisma } from "../../generated/prisma/client";

export type AnalyzerMappingGovernanceLike = {
  id: string;
  analyzerId: string;
  analyzerTestCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type AnalyzerMappingClinicalState = AnalyzerMappingGovernanceLike & {
  status: "ACTIVE" | "INACTIVE";
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  approvedAt: Date | null;
};

export type AnalyzerMappingUnit = {
  id: string;
  code: string;
  symbol: string;
  ucumCode: string | null;
};

export type AnalyzerMappingUnitSnapshot = {
  lisUnitIdSnapshot: string | null;
  lisUnitCodeSnapshot: string | null;
  lisUnitSymbolSnapshot: string | null;
  lisUnitUcumCodeSnapshot: string | null;
};

export function analyzerMappingIdentityKey(
  input: Pick<AnalyzerMappingGovernanceLike, "analyzerId" | "analyzerTestCode">,
) {
  return JSON.stringify([input.analyzerId, input.analyzerTestCode]);
}

export function analyzerMappingWindowsOverlap(
  left: Pick<AnalyzerMappingGovernanceLike, "effectiveFrom" | "effectiveTo">,
  right: Pick<AnalyzerMappingGovernanceLike, "effectiveFrom" | "effectiveTo">,
) {
  return (left.effectiveTo === null || right.effectiveFrom <= left.effectiveTo)
    && (right.effectiveTo === null || left.effectiveFrom <= right.effectiveTo);
}

export function sameAnalyzerMappingIdentity(
  left: Pick<AnalyzerMappingGovernanceLike, "analyzerId" | "analyzerTestCode">,
  right: Pick<AnalyzerMappingGovernanceLike, "analyzerId" | "analyzerTestCode">,
) {
  return left.analyzerId === right.analyzerId
    && left.analyzerTestCode === right.analyzerTestCode;
}

export function planAnalyzerMappingApproval(
  draft: AnalyzerMappingGovernanceLike,
  approved: AnalyzerMappingGovernanceLike[],
) {
  const predecessorsToClose: string[] = [];
  const conflicts: string[] = [];

  for (const current of approved) {
    if (current.id === draft.id || !sameAnalyzerMappingIdentity(draft, current)) continue;
    if (!analyzerMappingWindowsOverlap(draft, current)) continue;
    if (current.effectiveFrom < draft.effectiveFrom) predecessorsToClose.push(current.id);
    else conflicts.push(current.id);
  }
  return { predecessorsToClose, conflicts };
}

export function analyzerMappingClinicallyUsable(
  input: AnalyzerMappingClinicalState,
  at = new Date(),
) {
  return input.status === "ACTIVE"
    && input.approvalStatus === "APPROVED"
    && input.approvedAt !== null
    && input.effectiveFrom <= at
    && (input.effectiveTo === null || input.effectiveTo >= at);
}

export function analyzerMappingUnitConfigurationError(input: {
  analyzerUnitCode: string | null;
  targetUnit: AnalyzerMappingUnit | null;
}) {
  if (input.targetUnit && !input.analyzerUnitCode) return "analyzer_unit_code_required_for_unit_target" as const;
  if (!input.targetUnit && input.analyzerUnitCode) return "analyzer_unit_requires_lis_target_unit" as const;
  return null;
}

export function snapshotAnalyzerMappingTargetUnit(
  targetUnit: AnalyzerMappingUnit | null,
): AnalyzerMappingUnitSnapshot {
  return {
    lisUnitIdSnapshot: targetUnit?.id || null,
    lisUnitCodeSnapshot: targetUnit?.code || null,
    lisUnitSymbolSnapshot: targetUnit?.symbol || null,
    lisUnitUcumCodeSnapshot: targetUnit?.ucumCode || null,
  };
}

export function analyzerMappingTargetUnitStillMatches(
  snapshot: AnalyzerMappingUnitSnapshot,
  currentUnit: AnalyzerMappingUnit | null,
) {
  return snapshot.lisUnitIdSnapshot === (currentUnit?.id || null)
    && snapshot.lisUnitCodeSnapshot === (currentUnit?.code || null)
    && snapshot.lisUnitSymbolSnapshot === (currentUnit?.symbol || null)
    && snapshot.lisUnitUcumCodeSnapshot === (currentUnit?.ucumCode || null);
}

/**
 * Clinical analyzer routing needs provenance from two distinct people.
 * Old mappings with no creator cannot be approved by inferring an author.
 */
export function analyzerMappingIndependentApprovalError(input: {
  createdByUserId: string | null;
  approvalStatus: string;
  status: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  retiredAt: Date | null;
  retiredByUserId: string | null;
}, actorUserId: string): string | null {
  if (input.approvalStatus !== "DRAFT" || input.status !== "INACTIVE" ||
      input.approvedByUserId !== null || input.approvedAt !== null ||
      input.retiredAt !== null || input.retiredByUserId !== null) {
    return "analyzer_mapping_not_draft";
  }
  if (!input.createdByUserId) return "analyzer_mapping_creator_unknown";
  if (input.createdByUserId === actorUserId) return "analyzer_mapping_self_approval_forbidden";
  return null;
}

export type AnalyzerMappingReviewScope = {
  organizationId: string;
  branchId: string;
  userId: string;
  sessionBranchIds: readonly string[];
};

/**
 * Called AFTER acquiring the per-mapping-identity transaction lock.
 * Revoked approval permissions, revoked branch scopes or deactivated users
 * must not be honored merely because a session was valid before the lock.
 */
export async function analyzerMappingReviewerIsLive(
  tx: Prisma.TransactionClient,
  scope: AnalyzerMappingReviewScope,
): Promise<boolean> {
  if (!scope.sessionBranchIds.includes(scope.branchId)) return false;
  const organization = await tx.organization.findFirst({
    where: { id: scope.organizationId, status: "ACTIVE" }, select: { id: true },
  });
  if (!organization) return false;
  const user = await tx.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId, status: "ACTIVE" },
    select: { roles: { select: { role: {
      select: { status: true, organizationId: true,
        permissions: { select: { permission: { select: { code: true } } } } },
    } } } },
  });
  const approved = (user?.roles ?? []).some(grant =>
    grant.role.status === "ACTIVE" && grant.role.organizationId === scope.organizationId &&
    grant.role.permissions.some(p => p.permission.code === "analyzers.mappings.approve"));
  if (!approved) return false;
  const branch = await tx.userBranchScope.findFirst({
    where: {
      userId: scope.userId, branchId: scope.branchId,
      branch: { organizationId: scope.organizationId, status: "ACTIVE" },
    }, select: { branchId: true },
  });
  return !!branch;
}
