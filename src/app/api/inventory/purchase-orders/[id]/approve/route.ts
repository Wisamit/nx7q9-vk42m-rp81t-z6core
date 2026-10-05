import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("procurement.approve");
  const ctx = await requestContext();
  const { id } = await params;
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { items: true },
  });
  if (!po) return NextResponse.json({ error: "purchase_order_not_found" }, { status: 404 });
  if (!canAccessBranch(session, po.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (po.status !== "DRAFT") return NextResponse.json({ error: "purchase_order_not_approvable", status: po.status }, { status: 409 });
  if (po.items.length === 0) return NextResponse.json({ error: "purchase_order_empty" }, { status: 409 });

  const approvedAt = new Date();
  const updated = await prisma.$transaction(async tx => {
    const current = await tx.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
    if (!current || current.status !== "DRAFT") throw new Error("STATE_CHANGED");
    const result = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt, orderedAt: approvedAt },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: po.branchId,
        actorUserId: session.user.id,
        action: "PURCHASE_ORDER_APPROVED",
        entityType: "PurchaseOrder",
        entityId: po.id,
        oldValues: { status: "DRAFT" },
        newValues: { status: "APPROVED", approvedAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return result;
  }).catch(() => null);
  if (!updated) return NextResponse.json({ error: "purchase_order_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", purchaseOrder: updated });
}
