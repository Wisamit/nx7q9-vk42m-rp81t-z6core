import type { Prisma } from "../../generated/prisma/client";

export type ReportTemplateAuthorization = {
  organizationId: string;
  userId: string;
  branchId: string | null;
  activeBranchId: string;
  sessionBranchIds: string[];
};

/**
 * Re-check live role and active branch authorization while holding the
 * template row lock. A stale session must never approve or publish layouts.
 */
export async function reportTemplateEditorIsLive(
  tx: Prisma.TransactionClient, scope: ReportTemplateAuthorization,
): Promise<boolean> {
  const currentUser = await tx.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId, status: "ACTIVE" },
    include: { roles: { include: { role: { include: {
      permissions: { include: { permission: true } },
    } } } } },
  });
  const canManage = (currentUser?.roles ?? [])
    .filter(grant => grant.role.status === "ACTIVE" &&
      grant.role.organizationId === scope.organizationId)
    .some(grant => grant.role.permissions.some(p =>
      p.permission.code === "report_templates.manage"));
  if (!canManage) return false;
  const targetBranchId = scope.branchId ?? scope.activeBranchId;
  if (!targetBranchId || !scope.sessionBranchIds.includes(targetBranchId)) return false;
  const liveBranch = await tx.userBranchScope.findFirst({
    where: {
      userId: scope.userId,
      branchId: targetBranchId,
      branch: { organizationId: scope.organizationId, status: "ACTIVE" },
    },
    select: { branchId: true },
  });
  return !!liveBranch;
}

export type ReportTemplateTransition = {
  status: "DRAFT" | "APPROVED" | "EFFECTIVE" | "RETIRED";
  submittedByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  retiredAt: Date | null;
};

export function reportTemplateApprovalError(version: ReportTemplateTransition, actorUserId: string): string | null {
  if (version.status !== "DRAFT") return "template_version_not_draft";
  if (version.submittedByUserId === actorUserId) return "template_self_approval_forbidden";
  if (version.approvedByUserId || version.approvedAt || version.effectiveFrom || version.effectiveTo || version.retiredAt)
    return "template_version_invalid_approval_history";
  return null;
}

export function reportTemplateActivationError(version: ReportTemplateTransition, actorUserId: string): string | null {
  if (version.status !== "APPROVED") return "template_version_not_approved";
  if (!version.approvedAt || !version.approvedByUserId ||
      version.approvedByUserId === version.submittedByUserId ||
      version.approvedByUserId === actorUserId && version.submittedByUserId === actorUserId ||
      version.effectiveFrom || version.effectiveTo || version.retiredAt)
    return "template_version_approval_invalid";
  return null;
}

/** Custom backdated/future activation requires a separate governed scheduling workflow. */
export function immediateReportTemplateActivationOnly(input: unknown): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input as Record<string, unknown>).length === 0;
}
