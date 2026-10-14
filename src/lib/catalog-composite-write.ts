import type { Prisma } from "../../generated/prisma/client";
import { getCurrentSession, permissionSet } from "./auth";
import { prisma } from "./db";
import { clinicalImportTestWhere, resolveClinicalImportScope, type ClinicalImportScope } from "./catalog-clinical-import-scope";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
export class CompositeWriteError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 403) { super(code); this.code = code; this.status = status; }
}

export const compositeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/**
 * Never interpret revoked initial department grants as organization-wide
 * access: the existing scope resolver treats an empty grant list as global.
 */
export function intersectCompositeDepartments<T extends { departmentId: string }>(
  initiallyGranted: readonly string[], liveGrants: readonly T[],
): T[] {
  const initial = new Set(initiallyGranted);
  if (initial.size === 0) {
    if (liveGrants.length > 0) throw new CompositeWriteError("composite_department_scope_changed");
    return [];
  }
  const common = liveGrants.filter(item => initial.has(item.departmentId));
  if (common.length === 0) throw new CompositeWriteError("composite_department_scope_revoked");
  return common;
}

export type ProposedCompositeMember = { testId: string; displayOrder: number; required: boolean };

/** Fail closed for repeat, reordered or unbounded source member lists. */
export function parseCompositeMembers(
  body: Record<string, unknown>,
  type: "PANEL" | "PACKAGE",
): ProposedCompositeMember[] {
  const raw = body.members ?? body.testIds;
  const objects = body.members !== undefined;
  if (body.members !== undefined && body.testIds !== undefined)
    throw new CompositeWriteError("composite_multiple_membership_sources", 400);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 300)
    throw new CompositeWriteError("composite_invalid_membership", 400);
  const seenTest = new Set<string>(), seenOrder = new Set<number>();
  const members: ProposedCompositeMember[] = [];
  for (const [i, entry] of raw.entries()) {
    const fields = objects && entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown> : null;
    if (objects && (!fields ||
        Object.keys(fields).some(key => !["testId","displayOrder","required"].includes(key))))
      throw new CompositeWriteError("composite_invalid_member", 400);
    const id = objects ? fields?.testId : entry;
    const order = objects ? fields?.displayOrder : i;
    const required = objects && type === "PANEL" ? fields?.required : true;
    if (typeof id !== "string" || !compositeUuid.test(id) ||
        !Number.isSafeInteger(order) || (order as number) < 0 || (order as number) > 9999 ||
        typeof required !== "boolean" ||
        (objects && type === "PACKAGE" && fields?.required !== undefined))
      throw new CompositeWriteError("composite_invalid_member", 400);
    if (seenTest.has(id) || seenOrder.has(order as number))
      throw new CompositeWriteError("composite_duplicate_member", 400);
    seenTest.add(id); seenOrder.add(order as number);
    members.push({ testId: id, displayOrder: order as number, required });
  }
  return members.sort((a,b) => a.displayOrder - b.displayOrder);
}

/**
 * Shared clinical scope + transaction fence for human composite creation.
 * The org row lock coordinates with bundle import/review, and rechecks live
 * tenant roles, active branch, department grants, and entire membership.
 */
export async function withScopedCompositeCreation<T>(
  session: Session,
  memberIds: readonly string[],
  write: (tx: Prisma.TransactionClient, scope: ClinicalImportScope) => Promise<T>,
): Promise<T> {
  if (!permissionSet(session).has("catalog.manage"))
    throw new CompositeWriteError("composite_permission_required");
  const originalScope = resolveClinicalImportScope({
    organizationId: session.user.organizationId, activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch, branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!originalScope) throw new CompositeWriteError("active_clinical_import_scope_required");
  return prisma.$transaction(async tx => {
    const organizationId = session.user.organizationId;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE`;
    if (rows.length !== 1) throw new CompositeWriteError("organization_inactive");
    const [user, branch, liveBranches, liveDepartments] = await Promise.all([
      tx.user.findFirst({
        where: { id: session.user.id, organizationId, status: "ACTIVE" },
        select: { roles: { select: { role: { select: {
          organizationId: true, status: true,
          permissions: { select: { permission: { select: { code: true } } } },
        } } } } },
      }),
      tx.branch.findFirst({ where: { id: originalScope.branchId,
        organizationId, status: "ACTIVE" }, select: { id: true, organizationId: true, status: true } }),
      tx.userBranchScope.findMany({ where: { userId: session.user.id,
        branch: { organizationId, status: "ACTIVE" } },
        select: { branchId: true, branch: {
          select: { organizationId: true, status: true },
        } } }),
      tx.userDepartmentScope.findMany({ where: { userId: session.user.id },
        select: { departmentId: true, department: {
          select: { organizationId: true, branchId: true, status: true },
        } } }),
    ]);
    const livePermissions = new Set(user?.roles.filter(item =>
      item.role.organizationId === organizationId && item.role.status === "ACTIVE"
    ).flatMap(item => item.role.permissions.map(p => p.permission.code)) || []);
    if (!livePermissions.has("catalog.manage"))
      throw new CompositeWriteError("composite_permission_revoked");
    const initialBranches = new Set(session.user.branchScopes.map(item => item.branchId));
    const branchScopes = liveBranches.filter(item => initialBranches.has(item.branchId));
    const departmentScopes = intersectCompositeDepartments(
      session.user.departmentScopes.map(item => item.departmentId), liveDepartments,
    );
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: originalScope.branchId, activeBranch: branch,
      branchScopes, departmentScopes,
    });
    if (!scope) throw new CompositeWriteError("composite_scope_revoked");
    const allowed = await tx.labTest.count({
      where: { ...clinicalImportTestWhere(scope), id: { in: [...memberIds] } },
    });
    if (allowed !== memberIds.length) throw new CompositeWriteError("composite_member_outside_clinical_scope");
    return write(tx, scope);
  }, { timeout: 30000, isolationLevel: "Serializable" });
}
