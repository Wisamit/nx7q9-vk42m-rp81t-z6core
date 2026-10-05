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
  await prisma.$transaction(async tx => {
    await tx.homeCollectionVisit.update({
      where: { id },
      data: {
        assignedCollectorUserId: collectorId,
        status: nextStatus,
        scheduledDepartureAt: body.scheduledDepartureAt ? new Date(String(body.scheduledDepartureAt)) : visit.scheduledDepartureAt,
        dispatchedAt: nextStatus === "EN_ROUTE" ? now : visit.dispatchedAt,
        arrivedAt: nextStatus === "ARRIVED" ? now : visit.arrivedAt,
        collectionStartedAt: nextStatus === "COLLECTING" ? now : visit.collectionStartedAt,
        collectedAt: nextStatus === "COLLECTED" ? now : visit.collectedAt,
        deliveredToBranchAt: nextStatus === "DELIVERED" ? now : visit.deliveredToBranchAt,
        transportNotes,
      },
    });
    if (nextStatus === "DELIVERED" && visit.appointment.status !== "COMPLETED") {
      await tx.appointment.update({
        where: { id: visit.appointmentId },
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
  });

  return NextResponse.json({ status: "ok", visitStatus: nextStatus });
}
