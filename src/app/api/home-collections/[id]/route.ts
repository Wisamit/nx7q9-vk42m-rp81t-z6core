import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const transitions: Record<string, string[]> = {
  SCHEDULED: ["ASSIGNED","CANCELLED"],
  ASSIGNED: ["EN_ROUTE","CANCELLED"],
  EN_ROUTE: ["ARRIVED","CANCELLED"],
  ARRIVED: ["COLLECTING","CANCELLED"],
  COLLECTING: ["COLLECTED","CANCELLED"],
  COLLECTED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("home_collection.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const visit = await prisma.homeCollectionVisit.findFirst({
    where: { id, appointment: { organizationId: session.user.organizationId } },
    include: { appointment: true },
  });
  if (!visit) return NextResponse.json({ error: "home_collection_not_found" }, { status: 404 });
  if (!canAccessBranch(session, visit.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const nextStatus = typeof body.status === "string" ? body.status : visit.status;
  if (nextStatus !== visit.status && !(transitions[visit.status] || []).includes(nextStatus)) {
    return NextResponse.json({ error: "invalid_status_transition", from: visit.status, to: nextStatus }, { status: 409 });
  }

  const collectorId = text(body.assignedCollectorUserId, 36) || visit.assignedCollectorUserId;
  if (nextStatus === "ASSIGNED" && !collectorId) {
    return NextResponse.json({ error: "collector_required" }, { status: 400 });
  }
  if (collectorId) {
    const collector = await prisma.user.findFirst({
      where: {
        id: collectorId,
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        branchScopes: { some: { branchId: visit.branchId } },
      },
      select: { id: true },
    });
    if (!collector) return NextResponse.json({ error: "collector_not_authorized_for_branch" }, { status: 409 });
  }

  const now = new Date();
  const transportNotes = text(body.transportNotes) || visit.transportNotes;
  const scheduledDepartureAt = body.scheduledDepartureAt
    ? new Date(String(body.scheduledDepartureAt)) : visit.scheduledDepartureAt;
  if (scheduledDepartureAt && Number.isNaN(scheduledDepartureAt.getTime())) {
    return NextResponse.json({ error: "invalid_departure_date" }, { status: 400 });
  }
  try {
    await prisma.$transaction(async tx => {
      // Always lock appointment before its visit, matching appointment cancellation.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM appointments WHERE id = ${visit.appointmentId}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("APPOINTMENT_CHANGED");
      const parent = await tx.appointment.findUniqueOrThrow({ where: { id: visit.appointmentId } });
      const current = await tx.homeCollectionVisit.findUniqueOrThrow({ where: { id } });
      if (parent.mode !== "HOME_COLLECTION" || ["CANCELLED", "NO_SHOW"].includes(parent.status)) {
        throw new Error("APPOINTMENT_NOT_ACTIVE");
      }
      if (current.updatedAt.getTime() !== visit.updatedAt.getTime() ||
          (nextStatus !== current.status && !(transitions[current.status] || []).includes(nextStatus))) {
        throw new Error("VISIT_STATE_CHANGED");
      }
      if (nextStatus === "CANCELLED" && ["COLLECTING", "COLLECTED", "DELIVERED"].includes(current.status)) {
        throw new Error("SPECIMEN_CUSTODY_ALREADY_STARTED");
      }
      const claim = await tx.homeCollectionVisit.updateMany({
        where: { id, appointmentId: visit.appointmentId, status: current.status, updatedAt: current.updatedAt },
        data: {
        assignedCollectorUserId: collectorId,
        status: nextStatus,
        scheduledDepartureAt,
        dispatchedAt: nextStatus === "EN_ROUTE" ? now : visit.dispatchedAt,
        arrivedAt: nextStatus === "ARRIVED" ? now : visit.arrivedAt,
        collectionStartedAt: nextStatus === "COLLECTING" ? now : visit.collectionStartedAt,
        collectedAt: nextStatus === "COLLECTED" ? now : visit.collectedAt,
        deliveredToBranchAt: nextStatus === "DELIVERED" ? now : visit.deliveredToBranchAt,
        transportNotes,
      },
    });
      if (claim.count !== 1) throw new Error("VISIT_STATE_CHANGED");
    if (nextStatus === "DELIVERED") {
      if (!["CHECKED_IN", "CONFIRMED"].includes(parent.status)) throw new Error("APPOINTMENT_NOT_READY");
      await tx.appointment.updateMany({
        where: { id: visit.appointmentId, organizationId: session.user.organizationId, status: parent.status },
        data: { status: "COMPLETED", completedAt: now },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: visit.branchId,
        actorUserId: session.user.id,
        action: "HOME_COLLECTION_UPDATED",
        entityType: "HomeCollectionVisit",
        entityId: id,
        oldValues: { status: visit.status, assignedCollectorUserId: visit.assignedCollectorUserId },
        newValues: { status: nextStatus, assignedCollectorUserId: collectorId, transportNotes },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const codes = ["APPOINTMENT_NOT_ACTIVE", "APPOINTMENT_NOT_READY", "SPECIMEN_CUSTODY_ALREADY_STARTED"];
    return NextResponse.json({ error: codes.includes(reason) ? reason.toLowerCase() : "home_collection_state_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", visitStatus: nextStatus });
}
