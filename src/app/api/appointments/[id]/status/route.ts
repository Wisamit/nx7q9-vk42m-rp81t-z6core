import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const allowedTransitions: Record<string, string[]> = {
  REQUESTED: ["CONFIRMED","CANCELLED"],
  CONFIRMED: ["CHECKED_IN","CANCELLED","NO_SHOW"],
  CHECKED_IN: ["COMPLETED","CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("appointments.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const nextStatus = typeof body?.status === "string" ? body.status : "";
  const reason = text(body?.reason);
  if (!["CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","NO_SHOW"].includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!appointment) return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
  if (!canAccessBranch(session, appointment.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!(allowedTransitions[appointment.status] || []).includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status_transition", from: appointment.status, to: nextStatus }, { status: 409 });
  }
  if (nextStatus === "CANCELLED" && !reason) {
    return NextResponse.json({ error: "cancellation_reason_required" }, { status: 400 });
  }

  const now = new Date();
  try {
    await prisma.$transaction(async tx => {
      // Queue check-in, home collection and appointment status share this lock.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM appointments WHERE id = ${id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("APPOINTMENT_CHANGED");
      const current = await tx.appointment.findUniqueOrThrow({ where: { id } });
      if (!(allowedTransitions[current.status] || []).includes(nextStatus) ||
          current.updatedAt.getTime() !== appointment.updatedAt.getTime()) {
        throw new Error("APPOINTMENT_CHANGED");
      }
      if (nextStatus === "CANCELLED" && current.mode === "HOME_COLLECTION") {
        const visit = await tx.homeCollectionVisit.findUnique({ where: { appointmentId: id } });
        if (visit && !["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(visit.status)) {
          throw new Error("HOME_COLLECTION_ALREADY_STARTED");
        }
      }
      const claim = await tx.appointment.updateMany({
        where: { id, organizationId: session.user.organizationId, status: current.status, updatedAt: current.updatedAt },
        data: {
        status: nextStatus,
        checkedInAt: nextStatus === "CHECKED_IN" ? now : appointment.checkedInAt,
        completedAt: nextStatus === "COMPLETED" ? now : appointment.completedAt,
        cancelledAt: nextStatus === "CANCELLED" ? now : appointment.cancelledAt,
        cancellationReason: nextStatus === "CANCELLED" ? reason : current.cancellationReason,
      },
    });
      if (claim.count !== 1) throw new Error("APPOINTMENT_CHANGED");
    if (nextStatus === "CANCELLED" && current.mode === "HOME_COLLECTION") {
      await tx.homeCollectionVisit.updateMany({
        where: { appointmentId: id, status: { not: "CANCELLED" } },
        data: { status: "CANCELLED" },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: appointment.branchId,
        actorUserId: session.user.id,
        action: "APPOINTMENT_STATUS_CHANGED",
        entityType: "Appointment",
        entityId: id,
        oldValues: { status: appointment.status },
        newValues: { status: nextStatus },
        reason: reason || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reason === "HOME_COLLECTION_ALREADY_STARTED"
      ? "home_collection_already_started" : "appointment_status_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", appointmentStatus: nextStatus });
}
