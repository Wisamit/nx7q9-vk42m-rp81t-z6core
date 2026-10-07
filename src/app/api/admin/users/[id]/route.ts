import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function ids(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
}
function optionalDiscountPercent(value: unknown) {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric * 100) / 100 : undefined;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("users.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationId = session.user.organizationId;
  const target = await prisma.user.findFirst({
    where: { id, organizationId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { select: { permission: { select: { code: true } } } },
            },
          },
        },
      },
      branchScopes: true,
      departmentScopes: true,
    },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const displayNameEn = text(body.displayNameEn) || target.displayNameEn;
  const displayNameAr = body.displayNameAr === null ? "" : text(body.displayNameAr);
  const email = body.email === null ? "" : text(body.email, 191).toLowerCase();
  const preferredLocale = body.preferredLocale === "ar" ? "ar" : body.preferredLocale === "en" ? "en" : target.preferredLocale;
  const status = body.status === "ACTIVE" || body.status === "SUSPENDED" || body.status === "DISABLED" ? body.status : target.status;
  const roleIds = body.roleIds === undefined ? target.roles.map(x => x.roleId) : ids(body.roleIds);
  const branchIds = body.branchIds === undefined ? target.branchScopes.map(x => x.branchId) : ids(body.branchIds);
  const departmentIds = body.departmentIds === undefined ? target.departmentScopes.map(x => x.departmentId) : ids(body.departmentIds);
  const password = typeof body.password === "string" ? body.password : "";
  if (body.discountLimitPercent !== undefined && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_limit_forbidden" }, { status: 403 });
  }
  const discountLimitPercent = body.discountLimitPercent === undefined
    ? (target.discountLimitPercent ? Number(target.discountLimitPercent.toString()) : null)
    : optionalDiscountPercent(body.discountLimitPercent);

  if (!displayNameEn || roleIds.length === 0 || branchIds.length === 0 || (password && password.length < 12) || discountLimitPercent === undefined) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  if (id === session.user.id && status !== "ACTIVE") {
    return NextResponse.json({ error: "cannot_disable_self" }, { status: 409 });
  }

  const [roles, branchCount, departments] = await Promise.all([
    prisma.role.findMany({
      where: { id: { in: roleIds }, organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        discountLimitPercent: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    }),
    prisma.branch.count({ where: { id: { in: branchIds }, organizationId, status: "ACTIVE" } }),
    prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId, status: "ACTIVE" }, select: { id: true, branchId: true } }),
  ]);
  const departmentScopeInvalid = departments.length !== departmentIds.length
    || departments.some(department => department.branchId && !branchIds.includes(department.branchId));
  if (roles.length !== roleIds.length || branchCount !== branchIds.length || departmentScopeInvalid) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  const currentRoleLimit = target.roles
    .filter(assignment => assignment.role.status === "ACTIVE")
    .reduce((highest, assignment) => Math.max(highest, Number(assignment.role.discountLimitPercent.toString())), 0);
  const desiredRoleLimit = roles.reduce((highest, role) => Math.max(highest, Number(role.discountLimitPercent.toString())), 0);
  const sensitiveCodes = new Set(["billing.discount.approve", "billing.discount.limits.manage"]);
  const currentSensitiveDiscountPermissions = new Set(
    target.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .flatMap(assignment => assignment.role.permissions.map(grant => grant.permission.code))
      .filter(code => sensitiveCodes.has(code)),
  );
  const desiredSensitiveDiscountPermissions = new Set(
    roles
      .flatMap(role => role.permissions.map(grant => grant.permission.code))
      .filter(code => sensitiveCodes.has(code)),
  );
  const sensitivePermissionExpanded = [...desiredSensitiveDiscountPermissions]
    .some(code => !currentSensitiveDiscountPermissions.has(code));
  const hasDesiredSensitiveDiscountPermission = desiredSensitiveDiscountPermissions.size > 0;
  const currentBranchIds = new Set(target.branchScopes.map(scope => scope.branchId));
  const branchAuthorityExpanded = branchIds.some(branchId => !currentBranchIds.has(branchId))
    && (desiredRoleLimit > 0 || hasDesiredSensitiveDiscountPermission || (discountLimitPercent ?? 0) > 0);
  const financialAuthorityIncreased =
    desiredRoleLimit > currentRoleLimit
    || sensitivePermissionExpanded
    || branchAuthorityExpanded
    || (target.status !== "ACTIVE" && status === "ACTIVE"
      && (desiredRoleLimit > 0 || hasDesiredSensitiveDiscountPermission || (discountLimitPercent ?? 0) > 0));

  if (financialAuthorityIncreased && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_authority_forbidden" }, { status: 403 });
  }

  const cashierSensitiveCodes = new Set(["billing.cashier.approve", "billing.cashier.authority.manage"]);
  const currentCashierPermissions = new Set(
    target.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .flatMap(assignment => assignment.role.permissions.map(grant => grant.permission.code))
      .filter(code => cashierSensitiveCodes.has(code)),
  );
  const desiredCashierPermissions = new Set(
    roles
      .flatMap(role => role.permissions.map(grant => grant.permission.code))
      .filter(code => cashierSensitiveCodes.has(code)),
  );
  const cashierPermissionExpanded = [...desiredCashierPermissions].some(code => !currentCashierPermissions.has(code));
  const hasDesiredCashierAuthority = desiredCashierPermissions.size > 0;
  const cashierBranchAuthorityExpanded = branchIds.some(branchId => !currentBranchIds.has(branchId)) && hasDesiredCashierAuthority;
  const cashierAuthorityIncreased =
    cashierPermissionExpanded
    || cashierBranchAuthorityExpanded
    || (target.status !== "ACTIVE" && status === "ACTIVE" && hasDesiredCashierAuthority);
  if (cashierAuthorityIncreased && !permissions.has("billing.cashier.authority.manage")) {
    return NextResponse.json({ error: "cashier_authority_forbidden" }, { status: 403 });
  }

  const hadSystemAdmin = target.roles.some(x => x.role.code === "SYSTEM_ADMIN" && x.role.status === "ACTIVE");
  const keepsSystemAdmin = roles.some(x => x.code === "SYSTEM_ADMIN") && status === "ACTIVE";
  if (hadSystemAdmin && !keepsSystemAdmin) {
    const otherAdmins = await prisma.user.count({
      where: {
        organizationId,
        id: { not: id },
        status: "ACTIVE",
        roles: { some: { role: { code: "SYSTEM_ADMIN", status: "ACTIVE" } } },
      },
    });
    if (otherAdmins === 0) return NextResponse.json({ error: "last_system_admin" }, { status: 409 });
  }

  const passwordHash = password ? await hash(password, 12) : undefined;
  const ctx = await requestContext();

  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id },
      data: {
        displayNameEn,
        displayNameAr: displayNameAr || null,
        email: email || null,
        preferredLocale,
        discountLimitPercent: discountLimitPercent === null ? null : discountLimitPercent.toFixed(2),
        status,
        ...(passwordHash ? { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } : {}),
      },
    });
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roleIds.map(roleId => ({ userId: id, roleId, assignedBy: session.user.id })) });
    await tx.userBranchScope.deleteMany({ where: { userId: id } });
    await tx.userBranchScope.createMany({ data: branchIds.map(branchId => ({ userId: id, branchId })) });
    await tx.userDepartmentScope.deleteMany({ where: { userId: id } });
    if (departmentIds.length > 0) await tx.userDepartmentScope.createMany({ data: departmentIds.map(departmentId => ({ userId: id, departmentId })) });
    if (passwordHash || status !== "ACTIVE") await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({
      data: {
        organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: id,
        oldValues: { displayNameEn: target.displayNameEn, displayNameAr: target.displayNameAr, email: target.email, preferredLocale: target.preferredLocale, discountLimitPercent: target.discountLimitPercent?.toString() ?? null, status: target.status, roleIds: target.roles.map(x => x.roleId), branchIds: target.branchScopes.map(x => x.branchId), departmentIds: target.departmentScopes.map(x => x.departmentId) },
        newValues: { displayNameEn, displayNameAr: displayNameAr || null, email: email || null, preferredLocale, discountLimitPercent: discountLimitPercent === null ? null : discountLimitPercent.toFixed(2), status, roleIds, branchIds, departmentIds, passwordReset: Boolean(passwordHash) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
