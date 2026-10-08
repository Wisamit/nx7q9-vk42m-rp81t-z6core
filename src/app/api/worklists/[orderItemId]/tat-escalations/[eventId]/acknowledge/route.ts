import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderItemId: string; eventId: string }> },
) {
  const session = await requirePermission("worklists.tat_escalations.acknowledge");
  const ctx = await requestContext();
  const { orderItemId, eventId } = await params;
  const body = await request.json().catch(() => ({})) as { note?: unknown };
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

  const event = await prisma.tatEscalationEvent.findFirst({
    where: {
      id: eventId,
      orderItemId,
      organizationId: session.user.organizationId,
    },
    include: {
      orderItem: {
        select: {
          testCodeSnapshot: true,
          order: { select: { accessionNumber: true } },
        },
      },
    },
  });
  if (!event) return NextResponse.json({ error: "tat_escalation_not_found" }, { status: 404 });
  if (!canAccessBranch(session, event.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (event.status !== "OPEN") {
    return NextResponse.json({ error: "tat_escalation_not_open", status: event.status }, { status: 409 });
  }

  const acknowledgedAt = new Date();
  const result = await prisma.$transaction(async tx => {
    const changed = await tx.tatEscalationEvent.updateMany({
      where: { id: event.id, status: "OPEN", acknowledgedAt: null },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedByUserId: session.user.id,
        acknowledgedAt,
        acknowledgementNote: note || null,
      },
    });
    if (changed.count !== 1) return null;

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: event.branchId,
        actorUserId: session.user.id,
        action: "TAT_BREACH_ACKNOWLEDGED",
        entityType: "TatEscalationEvent",
        entityId: event.id,
        oldValues: { status: event.status },
        newValues: {
          status: "ACKNOWLEDGED",
          acknowledgedAt,
          acknowledgedByUserId: session.user.id,
          orderItemId,
          accessionNumber: event.orderItem.order.accessionNumber,
          testCode: event.orderItem.testCodeSnapshot,
          level: event.level,
        },
        reason: note || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return tx.tatEscalationEvent.findUniqueOrThrow({ where: { id: event.id } });
  });

  if (!result) {
    return NextResponse.json({ error: "tat_escalation_state_changed" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", event: result });
}
