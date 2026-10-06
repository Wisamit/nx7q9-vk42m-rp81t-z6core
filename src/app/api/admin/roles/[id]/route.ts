import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function ids(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
}
function discountPercent(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric * 100) / 100 : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("roles.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  const organizationId = session.user.organizationId;
  const current = await prisma.role.findFirst({
    where: { id, organizationId },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (current.isSystem) return NextResponse.json({ error: "system_role_locked" }, { status: 409 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const nameEn = text(body.nameEn, 150) || current.nameEn;
  const nameAr = body.nameAr === null ? "" : text(body.nameAr, 150);
  const status = body.status === "ACTIVE" || body.status === "INACTIVE" ? body.status : current.status;
  const permissionIds = body.permissionIds === undefined ? current.permissions.map(x => x.permissionId) : ids(body.permissionIds);
  if (body.discountLimitPercent !== undefined && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_limit_forbidden" }, { status: 403 });
  }
  const discountLimitPercent = body.discountLimitPercent === undefined
    ? Number(current.discountLimitPercent.toString())
    : discountPercent(body.discountLimitPercent);
  if (!nameEn || permissionIds.length === 0 || discountLimitPercent === null) return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  const selectedPermissions = await prisma.permission.findMany({
    where: { id: { in: permissionIds } },
    select: { id: true, code: true },
  });
  if (selectedPermissions.length !== permissionIds.length) return NextResponse.json({ error: "invalid_permissions" }, { status: 400 });

  const financialPermissionCodes = new Set(["billing.discount.approve", "billing.discount.limits.manage"]);
  const currentFinancialPermissions = new Set(current.permissions.filter(grant => financialPermissionCodes.has(grant.permission.code)).map(grant => grant.permission.code));
  const desiredFinancialPermissions = new Set(selectedPermissions.filter(permission => financialPermissionCodes.has(permission.code)).map(permission => permission.code));
  const financialAuthorityChanged = currentFinancialPermissions.size !== desiredFinancialPermissions.size
    || [...currentFinancialPermissions].some(code => !desiredFinancialPermissions.has(code));
  const financialRoleReactivated = current.status !== "ACTIVE"
    && status === "ACTIVE"
    && (Number(current.discountLimitPercent.toString()) > 0 || currentFinancialPermissions.size > 0);
  if ((financialAuthorityChanged || financialRoleReactivated) && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_authority_forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  await prisma.$transaction(async tx => {
    await tx.role.update({ where: { id }, data: { nameEn, nameAr: nameAr || null, discountLimitPercent: discountLimitPercent.toFixed(2), status } });
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.rolePermission.createMany({ data: permissionIds.map(permissionId => ({ roleId: id, permissionId })) });
    if (status === "INACTIVE") {
      const userIds = await tx.userRole.findMany({ where: { roleId: id }, select: { userId: true } });
      if (userIds.length) await tx.userSession.updateMany({ where: { userId: { in: userIds.map(x => x.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await tx.auditEvent.create({
      data: {
        organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "ROLE_UPDATED",
        entityType: "Role",
        entityId: id,
        oldValues: { nameEn: current.nameEn, nameAr: current.nameAr, discountLimitPercent: current.discountLimitPercent.toString(), status: current.status, permissionIds: current.permissions.map(x => x.permissionId) },
        newValues: { nameEn, nameAr: nameAr || null, discountLimitPercent: discountLimitPercent.toFixed(2), status, permissionIds },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
