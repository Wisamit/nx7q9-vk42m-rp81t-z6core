import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { normalizedPaymentMethodCode } from "@/lib/payment-methods";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function hasOrganizationScope(organizationId: string, branchScopes: Array<{ branchId: string; branch: { status: string } }>) {
  const activeBranches = await prisma.branch.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const accessible = new Set(branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));
  return activeBranches.length > 0 && activeBranches.every(branch => accessible.has(branch.id));
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.payment_methods.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!await hasOrganizationScope(session.user.organizationId, session.user.branchScopes)) {
    return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = normalizedPaymentMethodCode(body.code);
  const nameEn = text(body.nameEn, 160);
  const nameAr = text(body.nameAr, 160);
  const baseMethod = ["CASH","CARD","BANK_TRANSFER","ONLINE","OTHER"].includes(String(body.baseMethod))
    ? String(body.baseMethod) as "CASH" | "CARD" | "BANK_TRANSFER" | "ONLINE" | "OTHER"
    : null;
  const requiresReference = body.requiresReference === true;
  const rawSortOrder = Number(body.sortOrder ?? 0);
  const sortOrder = Number.isInteger(rawSortOrder) ? Math.max(-10000, Math.min(10000, rawSortOrder)) : null;

  if (!code || !nameEn || !baseMethod || sortOrder === null) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const ctx = await requestContext();
  try {
    const created = await prisma.$transaction(async tx => {
      const method = await tx.paymentMethodConfig.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr: nameAr || null,
          baseMethod,
          isSettlement: true,
          requiresReference,
          sortOrder,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PAYMENT_METHOD_CONFIG_CREATED",
          entityType: "PaymentMethodConfig",
          entityId: method.id,
          newValues: {
            code,
            nameEn,
            nameAr: nameAr || null,
            baseMethod,
            isSettlement: true,
            requiresReference,
            sortOrder,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return method;
    });
    return NextResponse.json({ status: "ok", method: created }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "payment_method_code_exists" }, { status: 409 });
    }
    throw error;
  }
}
