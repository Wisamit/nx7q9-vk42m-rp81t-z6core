import type { Prisma } from "../../generated/prisma/client.ts";
import { intersectLiveLegacyClinicalDepartments } from "./catalog-legacy-clinical-write-auth.ts";

export type CatalogReviewStagingAuthorityInput = {
  userId: string;
  organizationId: string;
  activeBranchId: string;
  sessionBranchIds: readonly string[];
  sessionDepartmentIds: readonly string[];
  needsPricing: boolean;
  needsRanges: boolean;
  needsClinicalScope: boolean;
};

/**
 * All required privileges must STILL be held through active same-tenant
 * roles. Separate roles may supply separate permissions; the union must
 * satisfy the request rather than requiring one role to have every grant.
 */
export function liveCatalogReviewStagingActorWhere(
  input: CatalogReviewStagingAuthorityInput,
): Prisma.UserWhereInput {
  const permissions = [
    "catalog.manage",
    ...(input.needsPricing ? ["pricing.manage"] : []),
    ...(input.needsRanges ? ["catalog.reference_ranges.manage"] : []),
  ];
  return {
    id: input.userId,
    organizationId: input.organizationId,
    status: "ACTIVE",
    organization: { status: "ACTIVE" },
    AND: permissions.map(code => ({
      roles: { some: { role: {
        organizationId: input.organizationId,
        status: "ACTIVE",
        permissions: { some: { permission: { code } } },
      } } },
    })),
  };
}

/**
 * Call only AFTER locking the ACTIVE organization row, immediately before
 * storing DRAFT review data. Both the original session and current DB scope
 * must allow the active branch and every referenced branch. Clinical
 * department grants cannot widen when revoked or changed mid-upload.
 */
export async function liveCatalogReviewStagingAuthority(
  tx: Prisma.TransactionClient,
  input: CatalogReviewStagingAuthorityInput,
): Promise<{ branchIds: string[]; departmentIds: readonly string[] } | null> {
  if (!input.sessionBranchIds.includes(input.activeBranchId)) return null;
  const actor = await tx.user.findFirst({
    where: liveCatalogReviewStagingActorWhere(input),
    select: { id: true },
  });
  if (!actor) return null;
  const branches = await tx.userBranchScope.findMany({
    where: { userId: input.userId,
      branch: { organizationId: input.organizationId, status: "ACTIVE" } },
    select: { branchId: true },
  });
  const oldBranches = new Set(input.sessionBranchIds);
  const branchIds = [...new Set(branches.map(grant => grant.branchId)
    .filter(id => oldBranches.has(id)))];
  if (!branchIds.includes(input.activeBranchId)) return null;

  if (!input.needsClinicalScope) return { branchIds, departmentIds: [] };
  const departments = await tx.userDepartmentScope.findMany({
    where: { userId: input.userId },
    select: { departmentId: true, department: {
      select: { organizationId: true, branchId: true, status: true },
    } },
  });
  const departmentIds = intersectLiveLegacyClinicalDepartments(
    input.organizationId, input.activeBranchId,
    input.sessionDepartmentIds, departments,
  );
  if (!departmentIds) return null;
  return { branchIds, departmentIds };
}
