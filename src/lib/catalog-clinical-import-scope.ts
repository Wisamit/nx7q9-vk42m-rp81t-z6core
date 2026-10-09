import type { Prisma } from "../../generated/prisma/client";

export type ClinicalImportScope = {
  organizationId: string;
  branchId: string;
  departmentIds: readonly string[];
};

type ScopeInput = {
  organizationId: string;
  activeBranchId: string | null;
  activeBranch: { id: string; organizationId: string; status: string } | null;
  branchScopes: readonly { branchId: string; branch: { status: string } }[];
  departmentScopes: readonly { departmentId: string; department: { status: string; organizationId: string; branchId: string | null } }[];
};

/** Fail closed if the session's current branch is not active and explicitly granted. */
export function resolveClinicalImportScope(session: ScopeInput): ClinicalImportScope | null {
  const branchId = session.activeBranchId;
  if (!branchId || session.activeBranch?.id !== branchId ||
      session.activeBranch.status !== "ACTIVE" ||
      session.activeBranch.organizationId !== session.organizationId ||
      !session.branchScopes.some(scope => scope.branchId === branchId && scope.branch.status === "ACTIVE")) {
    return null;
  }
  const departments = session.departmentScopes.filter(scope =>
    scope.department.status === "ACTIVE" &&
    scope.department.organizationId === session.organizationId &&
    (scope.department.branchId === null || scope.department.branchId === branchId)
  );
  // Existing LIS policy: no department grants means organization-wide
  // department access, still limited to the active branch's departments.
  // Having only INACTIVE/foreign-branch grants must not enlarge permissions.
  const hasDepartmentGrants = session.departmentScopes.length > 0;
  if (hasDepartmentGrants && departments.length === 0) return null;
  return {
    organizationId: session.organizationId,
    branchId,
    departmentIds: departments.map(scope => scope.departmentId),
  };
}

export function permittedClinicalImportTest(
  test: { departmentId: string | null; department: { branchId: string | null; status: string } | null },
  scope: ClinicalImportScope,
): boolean {
  if (scope.departmentIds.length > 0 && (!test.departmentId || !scope.departmentIds.includes(test.departmentId))) return false;
  if (test.departmentId && (!test.department || test.department.status !== "ACTIVE")) return false;
  return !test.department?.branchId || test.department.branchId === scope.branchId;
}

/** Restrict database reads AND transaction-time clinical writes by test scope. */
export function clinicalImportTestWhere(scope: ClinicalImportScope): Prisma.LabTestWhereInput {
  return {
    organizationId: scope.organizationId,
    status: "ACTIVE",
    ...(scope.departmentIds.length ? { departmentId: { in: [...scope.departmentIds] } } : {}),
    OR: [
      { departmentId: null },
      { department: { is: {
        status: "ACTIVE",
        OR: [{ branchId: null }, { branchId: scope.branchId }],
      } } },
    ],
  };
}
