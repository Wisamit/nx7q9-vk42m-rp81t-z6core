import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveDiscountLimit } from "@/lib/discount-policy";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function ids(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
}
function optionalDiscountPercent(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric * 100) / 100 : undefined;
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissionsForViewer = permissionSet(session);
  if (!permissionsForViewer.has("users.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const canManageDiscountLimits = permissionsForViewer.has("billing.discount.limits.manage");

  const organizationId = session.user.organizationId;
  const [users, roles, branches, departments] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      include: {
        roles: { include: { role: true } },
        branchScopes: { include: { branch: true } },
        departmentScopes: { include: { department: true } },
      },
      orderBy: [{ status: "asc" }, { displayNameEn: "asc" }],
    }),
    prisma.role.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: [{ isSystem: "desc" }, { nameEn: "asc" }] }),
    prisma.branch.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    prisma.department.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
  ]);

  return NextResponse.json({
    users: users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      displayNameEn: user.displayNameEn,
      displayNameAr: user.displayNameAr,
      preferredLocale: user.preferredLocale,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      ...(canManageDiscountLimits ? {
        discountLimitPercent: user.discountLimitPercent?.toString() ?? null,
        effectiveDiscountLimitPercent: effectiveDiscountLimit({
          userOverride: user.discountLimitPercent,
          roleLimits: user.roles.filter(x => x.role.status === "ACTIVE").map(x => x.role.discountLimitPercent),
        }).toFixed(2),
      } : {}),
      roleIds: user.roles.filter(x => x.role.status === "ACTIVE").map(x => x.roleId),
      roleNames: user.roles.filter(x => x.role.status === "ACTIVE").map(x => x.role.nameEn),
      branchIds: user.branchScopes.filter(x => x.branch.status === "ACTIVE").map(x => x.branchId),
      branchNames: user.branchScopes.filter(x => x.branch.status === "ACTIVE").map(x => x.branch.nameEn),
      departmentIds: user.departmentScopes.filter(x => x.department.status === "ACTIVE").map(x => x.departmentId),
      departmentNames: user.departmentScopes.filter(x => x.department.status === "ACTIVE").map(x => x.department.nameEn),
    })),
    roles: roles.map(role => ({ id: role.id, code: role.code, nameEn: role.nameEn, nameAr: role.nameAr, isSystem: role.isSystem, ...(canManageDiscountLimits ? { discountLimitPercent: role.discountLimitPercent.toString() } : {}) })),
    branches: branches.map(branch => ({ id: branch.id, code: branch.code, nameEn: branch.nameEn, nameAr: branch.nameAr })),
    departments: departments.map(department => ({ id: department.id, code: department.code, nameEn: department.nameEn, nameAr: department.nameAr, branchId: department.branchId })),
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("users.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationId = session.user.organizationId;
  const username = text(body.username, 100).toLowerCase();
  const email = text(body.email, 191).toLowerCase();
  const displayNameEn = text(body.displayNameEn);
  const displayNameAr = text(body.displayNameAr);
  const password = typeof body.password === "string" ? body.password : "";
  const preferredLocale = body.preferredLocale === "ar" ? "ar" : "en";
  const roleIds = ids(body.roleIds);
  const branchIds = ids(body.branchIds);
  const departmentIds = ids(body.departmentIds);
  const discountLimitPercent = optionalDiscountPercent(body.discountLimitPercent);
  if (body.discountLimitPercent !== undefined && body.discountLimitPercent !== null && body.discountLimitPercent !== "" && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_limit_forbidden" }, { status: 403 });
  }

  if (!/^[a-z0-9._-]{3,100}$/.test(username) || !displayNameEn || password.length < 12 || roleIds.length === 0 || branchIds.length === 0 || discountLimitPercent === undefined) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const [roles, branchCount, departments] = await Promise.all([
    prisma.role.findMany({
      where: { id: { in: roleIds }, organizationId, status: "ACTIVE" },
      select: {
        id: true,
        discountLimitPercent: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    }),
    prisma.branch.count({ where: { id: { in: branchIds }, organizationId, status: "ACTIVE" } }),
    prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId, status: "ACTIVE" }, select: { id: true, branchId: true } }),
  ]);
  const departmentScopeInvalid = departments.length !== departmentIds.length
    || departments.some(department => department.branchId && !branchIds.includes(department.branchId));
  if (roles.length !== roleIds.length || branchCount !== branchIds.length || departmentScopeInvalid) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  const roleGrantsFinancialAuthority = roles.some(role =>
    Number(role.discountLimitPercent.toString()) > 0
    || role.permissions.some(grant => ["billing.discount.approve", "billing.discount.limits.manage"].includes(grant.permission.code))
  );
  const overrideGrantsFinancialAuthority = (discountLimitPercent ?? 0) > 0;
  if ((roleGrantsFinancialAuthority || overrideGrantsFinancialAuthority) && !permissions.has("billing.discount.limits.manage")) {
    return NextResponse.json({ error: "discount_authority_forbidden" }, { status: 403 });
  }
  const roleGrantsCashierAuthority = roles.some(role =>
    role.permissions.some(grant => ["billing.cashier.approve", "billing.cashier.authority.manage"].includes(grant.permission.code))
  );
  if (roleGrantsCashierAuthority && !permissions.has("billing.cashier.authority.manage")) {
    return NextResponse.json({ error: "cashier_authority_forbidden" }, { status: 403 });
  }

  const passwordHash = await hash(password, 12);
  const ctx = await requestContext();

  try {
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          organizationId,
          username,
          email: email || null,
          passwordHash,
          displayNameEn,
          displayNameAr: displayNameAr || null,
          preferredLocale,
          discountLimitPercent: discountLimitPercent === null ? null : discountLimitPercent.toFixed(2),
          status: "ACTIVE",
          passwordChangedAt: new Date(),
          roles: { create: roleIds.map(roleId => ({ roleId, assignedBy: session.user.id })) },
          branchScopes: { create: branchIds.map(branchId => ({ branchId })) },
          departmentScopes: departmentIds.length > 0 ? { create: departmentIds.map(departmentId => ({ departmentId })) } : undefined,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "USER_CREATED",
          entityType: "User",
          entityId: created.id,
          newValues: { username, email: email || null, displayNameEn, displayNameAr: displayNameAr || null, preferredLocale, discountLimitPercent: discountLimitPercent === null ? null : discountLimitPercent.toFixed(2), roleIds, branchIds, departmentIds },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ userId: user.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "user_create_failed" }, { status: 409 });
  }
}
