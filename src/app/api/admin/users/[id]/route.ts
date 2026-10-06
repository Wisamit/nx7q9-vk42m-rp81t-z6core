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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("users.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationId = session.user.organizationId;
  const target = await prisma.user.findFirst({
    where: { id, organizationId },
    include: { roles: { include: { role: true } }, branchScopes: true },
  });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const displayNameEn = text(body.displayNameEn) || target.displayNameEn;
  const displayNameAr = body.displayNameAr === null ? "" : text(body.displayNameAr);
  const email = body.email === null ? "" : text(body.email, 191).toLowerCase();
  const preferredLocale = body.preferredLocale === "ar" ? "ar" : body.preferredLocale === "en" ? "en" : target.preferredLocale;
  const status = body.status === "ACTIVE" || body.status === "SUSPENDED" || body.status === "DISABLED" ? body.status : target.status;
  const roleIds = body.roleIds === undefined ? target.roles.map(x => x.roleId) : ids(body.roleIds);
  const branchIds = body.branchIds === undefined ? target.branchScopes.map(x => x.branchId) : ids(body.branchIds);
  const password = typeof body.password === "string" ? body.password : "";

  if (!displayNameEn || roleIds.length === 0 || branchIds.length === 0 || (password && password.length < 12)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  if (id === session.user.id && status !== "ACTIVE") {
    return NextResponse.json({ error: "cannot_disable_self" }, { status: 409 });
  }

  const [roles, branchCount] = await Promise.all([
    prisma.role.findMany({ where: { id: { in: roleIds }, organizationId, status: "ACTIVE" }, select: { id: true, code: true } }),
    prisma.branch.count({ where: { id: { in: branchIds }, organizationId, status: "ACTIVE" } }),
  ]);
  if (roles.length !== roleIds.length || branchCount !== branchIds.length) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

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
        status,
        ...(passwordHash ? { passwordHash, passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } : {}),
      },
    });
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roleIds.map(roleId => ({ userId: id, roleId, assignedBy: session.user.id })) });
    await tx.userBranchScope.deleteMany({ where: { userId: id } });
    await tx.userBranchScope.createMany({ data: branchIds.map(branchId => ({ userId: id, branchId })) });
    if (passwordHash || status !== "ACTIVE") await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({
      data: {
        organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: id,
        oldValues: { displayNameEn: target.displayNameEn, displayNameAr: target.displayNameAr, email: target.email, preferredLocale: target.preferredLocale, status: target.status, roleIds: target.roles.map(x => x.roleId), branchIds: target.branchScopes.map(x => x.branchId) },
        newValues: { displayNameEn, displayNameAr: displayNameAr || null, email: email || null, preferredLocale, status, roleIds, branchIds, passwordReset: Boolean(passwordHash) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
