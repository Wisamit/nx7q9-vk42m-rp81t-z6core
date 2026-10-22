/**
 * Authorization boundary for existing staff sessions.
 *
 * A previously authenticated session is no longer usable when its tenant,
 * active branch or active branch scope is retired. No implicit failover to
 * another branch is allowed; re-authentication must establish a new workspace.
 */
export type StaffSessionWorkspace = {
  activeBranchId: string | null;
  activeBranch: {
    id: string;
    organizationId: string;
    status: string;
  } | null;
  user: {
    organizationId: string;
    organization: { status: string };
    branchScopes: ReadonlyArray<{
      branchId: string;
      branch: { organizationId: string; status: string };
    }>;
  };
};

export function hasLiveStaffWorkspace(session: StaffSessionWorkspace): boolean {
  const orgId = session.user.organizationId;
  const branchId = session.activeBranchId;
  const branch = session.activeBranch;
  if (session.user.organization.status !== "ACTIVE" ||
      !branchId || !branch ||
      branch.id !== branchId ||
      branch.status !== "ACTIVE" ||
      branch.organizationId !== orgId) return false;
  return session.user.branchScopes.some(scope =>
    scope.branchId === branchId &&
    scope.branch.organizationId === orgId &&
    scope.branch.status === "ACTIVE"
  );
}
