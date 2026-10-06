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
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric * 100) / 100 : null;
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("roles.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const organizationId = session.user.organizationId;
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      where: { organizationId },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: [{ isSystem: "desc" }, { status: "asc" }, { nameEn: "asc" }],
    }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { code: "asc" }] }),
  ]);
  return NextResponse.json({
    roles: roles.map(role => ({
      id: role.id,
      code: role.code,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      isSystem: role.isSystem,
      status: role.status,
      discountLimitPercent: role.discountLimitPercent.toString(),
      userCount: role._count.users,
      permissionIds: role.permissions.map(x => x.permissionId),
    })),
    permissions: permissions.map(permission => ({
      id: permission.id,
      code: permission.code,
      module: permission.module,
      description: permission.description,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("roles.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationId = session.user.organizationId;
  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 150);
  const nameAr = text(body.nameAr, 150);
  const permissionIds = ids(body.permissionIds);
  const discountLimitPercent = discountPercent(body.discountLimitPercent);
  if ((body.discountLimitPercent !== undefined && Number(body.discountLimitPercent || 0) !== 0) && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_limit_forbidden" }, { status: 403 });
  }
  if (!/^[A-Z0-9._-]{2,80}$/.test(code) || !nameEn || permissionIds.length === 0 || discountLimitPercent === null) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  const selectedPermissions = await prisma.permission.findMany({
    where: { id: { in: permissionIds } },
    select: { id: true, code: true },
  });
  if (selectedPermissions.length !== permissionIds.length) return NextResponse.json({ error: "invalid_permissions" }, { status: 400 });
  if (selectedPermissions.some(permission => permission.code === "billing.discount.approve") && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_authority_forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  try {
    const role = await prisma.$transaction(async tx => {
      const created = await tx.role.create({
        data: {
          organizationId,
          code,
          nameEn,
          nameAr: nameAr || null,
          isSystem: false,
          discountLimitPercent: discountLimitPercent.toFixed(2),
          status: "ACTIVE",
          permissions: { create: permissionIds.map(permissionId => ({ permissionId })) },
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "ROLE_CREATED",
          entityType: "Role",
          entityId: created.id,
          newValues: { code, nameEn, nameAr: nameAr || null, discountLimitPercent: discountLimitPercent.toFixed(2), permissionIds },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ roleId: role.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "role_create_failed" }, { status: 409 });
  }
}
