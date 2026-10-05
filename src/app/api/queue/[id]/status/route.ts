import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const transitions: Record<string, string[]> = {
  WAITING: ["CALLED","CANCELLED","NO_SHOW"],
  CALLED: ["SERVING","WAITING","NO_SHOW"],
  SERVING: ["COMPLETED","CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function text(value: unknown, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("queue.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const nextStatus = typeof body?.status === "string" ? body.status : "";
  if (!["CALLED","SERVING","COMPLETED","WAITING","CANCELLED","NO_SHOW"].includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const ticket = await prisma.queueTicket.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!ticket) return NextResponse.json({ error: "queue_ticket_not_found" }, { status: 404 });
  if (!canAccessBranch(session, ticket.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!(transitions[ticket.status] || []).includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status_transition", from: ticket.status, to: nextStatus }, { status: 409 });
  }

  const now = new Date();
  const counterLabel = text(body?.counterLabel) || ticket.counterLabel;
  await prisma.$transaction(async tx => {
    await tx.queueTicket.update({
      where: { id },
      data: {
        status: nextStatus,
        counterLabel,
        calledByUserId: nextStatus === "CALLED" ? session.user.id : ticket.calledByUserId,
        calledAt: nextStatus === "CALLED" ? now : ticket.calledAt,
        serviceStartedAt: nextStatus === "SERVING" ? now : ticket.serviceStartedAt,
        completedAt: nextStatus === "COMPLETED" ? now : ticket.completedAt,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: ticket.branchId,
        actorUserId: session.user.id,
        action: "QUEUE_TICKET_STATUS_CHANGED",
        entityType: "QueueTicket",
        entityId: id,
        oldValues: { status: ticket.status, counterLabel: ticket.counterLabel },
        newValues: { status: nextStatus, counterLabel },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok", queueStatus: nextStatus });
}
