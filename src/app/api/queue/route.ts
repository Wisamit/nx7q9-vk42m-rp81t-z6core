import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function startOfUtcDay(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function POST(request: Request) {
  const session = await requirePermission("queue.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const patientId = text(body.patientId, 36);
  const appointmentId = text(body.appointmentId, 36) || null;
  const stage = body.stage === "PHLEBOTOMY" ? "PHLEBOTOMY" : "RECEPTION";
  const priority = Number.isInteger(body.priority) ? Math.max(-100, Math.min(100, body.priority)) : 0;
  if (!branchId || !patientId) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [branch, patient, appointment] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    appointmentId ? prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId: session.user.organizationId, branchId, patientId },
    }) : Promise.resolve(null),
  ]);
  if (!branch || !patient || (appointmentId && !appointment)) {
    return NextResponse.json({ error: "queue_context_not_found" }, { status: 404 });
  }

  const queueDate = startOfUtcDay();
  const prefix = stage === "PHLEBOTOMY" ? "P" : "R";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const ticket = await prisma.$transaction(async tx => {
        const latest = await tx.queueTicket.findFirst({
          where: { branchId, stage, queueDate },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        const sequence = (latest?.sequence || 0) + 1;
        const ticketNumber = prefix + String(sequence).padStart(3, "0");
        const created = await tx.queueTicket.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            patientId,
            appointmentId,
            ticketNumber,
            queueDate,
            sequence,
            stage,
            priority,
            issuedByUserId: session.user.id,
          },
        });
        if (appointment && appointment.status === "CONFIRMED") {
          await tx.appointment.update({
            where: { id: appointment.id },
            data: { status: "CHECKED_IN", checkedInAt: new Date() },
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: "QUEUE_TICKET_ISSUED",
            entityType: "QueueTicket",
            entityId: created.id,
            newValues: { ticketNumber, queueDate, sequence, stage, patientId, appointmentId, priority },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        return created;
      });
      return NextResponse.json({ status: "ok", ticket }, { status: 201 });
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  return NextResponse.json({ error: "queue_sequence_conflict" }, { status: 409 });
}
