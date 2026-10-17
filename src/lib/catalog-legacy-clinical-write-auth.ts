import type { Prisma } from "../../generated/prisma/client.ts";
import type { ClinicalImportScope } from "./catalog-clinical-import-scope.ts";

/**
 * Every clinical legacy mutation must re-authorize CURRENT role, user,
 * organization and exact active branch after acquiring the tenant lock.
 * The earlier session scope is a ceiling, not a lasting capability.
 */
export function liveLegacyClinicalWriteActorWhere(
  userId: string, organizationId: string, branchId: string,
): Prisma.UserWhereInput {
  return {
    id: userId, organizationId, status: "ACTIVE",
    organization: { status: "ACTIVE" },
    roles: { some: { role: {
      organizationId, status: "ACTIVE",
      permissions: { some: { permission: { code: "catalog.reference_ranges.manage" } } },
    } } },
    branchScopes: { some: {
      branchId, branch: { organizationId, status: "ACTIVE" },
    } },
  };
}

type CurrentDepartmentGrant = {
  departmentId: string;
  department: { organizationId: string; branchId: string | null; status: string };
};

/**
 * A revoked, inactive, foreign or off-branch department may not authorize
 * work. The intersection with the original session prevents new grants from
 * widening an in-flight request. A genuinely unrestricted session remains
 * unrestricted only when CURRENT grants are also empty.
 */
export function intersectLiveLegacyClinicalDepartments(
  organizationId: string, branchId: string,
  sessionDepartmentIds: readonly string[],
  currentGrants: readonly CurrentDepartmentGrant[],
): readonly string[] | null {
  const sessionRestricted = sessionDepartmentIds.length > 0;
  const old = new Set(sessionDepartmentIds);
  const currentRestricted = currentGrants.length > 0;
  const ids = [...new Set(currentGrants.filter(grant =>
    grant.department.status === "ACTIVE" &&
    grant.department.organizationId === organizationId &&
    (grant.department.branchId === null || grant.department.branchId === branchId) &&
    (!sessionRestricted || old.has(grant.departmentId))
  ).map(grant => grant.departmentId))];
  if ((sessionRestricted || currentRestricted) && ids.length === 0) return null;
  return ids;
}

export type LiveLegacyClinicalWriteInput = {
  organizationId: string;
  userId: string;
  branchId: string;
  sessionBranchIds: readonly string[];
  sessionDepartmentIds: readonly string[];
};

/**
 * Called from inside the same Prisma transaction, AFTER the tenant FOR UPDATE
 * lock and BEFORE creating units, interval drafts or alias mappings.
 */
export async function liveLegacyClinicalWriteScope(
  tx: Prisma.TransactionClient,
  input: LiveLegacyClinicalWriteInput,
): Promise<ClinicalImportScope | null> {
  const { organizationId, userId, branchId } = input;
  if (!input.sessionBranchIds.includes(branchId)) return null;
  const actor = await tx.user.findFirst({
    where: liveLegacyClinicalWriteActorWhere(userId, organizationId, branchId),
    select: { id: true },
  });
  if (!actor) return null;
  const grants = await tx.userDepartmentScope.findMany({
    where: { userId },
    select: { departmentId: true, department: {
      select: { organizationId: true, branchId: true, status: true },
    } },
  });
  const departmentIds = intersectLiveLegacyClinicalDepartments(
    organizationId, branchId, input.sessionDepartmentIds, grants,
  );
  if (!departmentIds) return null;
  return { organizationId, branchId, departmentIds };
}
