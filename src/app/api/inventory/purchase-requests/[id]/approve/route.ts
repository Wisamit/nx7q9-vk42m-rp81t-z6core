import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("procurement.approve");
  const ctx = await requestContext();
  const { id } = await params;
  const doc = await prisma.purchaseRequest.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { items: true },
  });
  if (!doc) return NextResponse.json({ error: "purchase_request_not_found" }, { status: 404 });
  if (!canAccessBranch(session, doc.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!["DRAFT","SUBMITTED"].includes(doc.status)) return NextResponse.json({ error: "purchase_request_not_approvable", status: doc.status }, { status: 409 });
  if (doc.items.length === 0) return NextResponse.json({ error: "purchase_request_empty" }, { status: 409 });

  const approvedAt = new Date();
  const updated = await prisma.$transaction(async tx => {
    const current = await tx.purchaseRequest.findUnique({ where: { id: doc.id }, select: { status: true } });
    if (!current || !["DRAFT","SUBMITTED"].includes(current.status)) throw new Error("STATE_CHANGED");
    const result = await tx.purchaseRequest.update({
      where: { id: doc.id },
      data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: doc.branchId,
        actorUserId: session.user.id,
        action: "PURCHASE_REQUEST_APPROVED",
        entityType: "PurchaseRequest",
        entityId: doc.id,
        oldValues: { status: current.status },
        newValues: { status: "APPROVED", approvedAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return result;
  }).catch(() => null);
  if (!updated) return NextResponse.json({ error: "purchase_request_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", purchaseRequest: updated });
}
