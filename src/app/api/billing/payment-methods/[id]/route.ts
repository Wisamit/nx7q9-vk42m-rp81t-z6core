import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.payment_methods.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!await hasOrganizationScope(session.user.organizationId, session.user.branchScopes)) {
    return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const status = body.status === "ACTIVE" || body.status === "INACTIVE" ? body.status : null;
  const reason = text(body.reason, 1000);
  if (!status || !reason) return NextResponse.json({ error: "status_and_reason_required" }, { status: 400 });

  const current = await prisma.paymentMethodConfig.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!current) return NextResponse.json({ error: "payment_method_not_found" }, { status: 404 });
  if (!current.isSettlement) {
    return NextResponse.json({ error: "system_nonsettlement_method_locked" }, { status: 409 });
  }
  if (current.status === status) {
    return NextResponse.json({ status: "ok", methodId: id, methodStatus: status });
  }

  const ctx = await requestContext();
  const updated = await prisma.$transaction(async tx => {
    const changed = await tx.paymentMethodConfig.updateMany({
      where: { id, organizationId: session.user.organizationId, status: current.status },
      data: {
        status,
        deactivatedAt: status === "INACTIVE" ? new Date() : null,
      },
    });
    if (changed.count !== 1) return null;

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: status === "ACTIVE" ? "PAYMENT_METHOD_CONFIG_ACTIVATED" : "PAYMENT_METHOD_CONFIG_DEACTIVATED",
        entityType: "PaymentMethodConfig",
        entityId: id,
        reason,
        oldValues: { status: current.status },
        newValues: { status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return id;
  });

  if (!updated) return NextResponse.json({ error: "payment_method_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", methodId: id, methodStatus: status });
}
