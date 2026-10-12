import { NextResponse } from "next/server";
import { canAccessBranch, requireSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { homeCollectionCustodyError, homeCollectionStartError } from "@/lib/home-collection-custody";

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
  const session = await requireSession();
  const permissions = permissionSet(session);
  const manager = permissions.has("home_collection.manage");
  const authorizedCollector = permissions.has("specimens.collect");
  if (!manager && !authorizedCollector) {
    return NextResponse.json({ error: "home_collection_permission_required" }, { status: 403 });
  }
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const visit = await prisma.homeCollectionVisit.findFirst({
    where: { id, appointment: { organizationId: session.user.organizationId } },
    include: { appointment: true },
  });
  if (!visit) return NextResponse.json({ error: "home_collection_not_found" }, { status: 404 });
  if (!manager && (visit.assignedCollectorUserId !== session.user.id ||
    !["EN_ROUTE","ARRIVED","COLLECTING","COLLECTED"].includes(String(body.status)))) {
    return NextResponse.json({ error: "assigned_collector_required" }, { status: 403 });
  }
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
      const lockedVisit = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM home_collection_visits WHERE id = ${id}
        AND appointment_id = ${visit.appointmentId} AND branch_id = ${visit.branchId}
        FOR UPDATE
      `;
      if (lockedVisit.length !== 1) throw new Error("VISIT_STATE_CHANGED");
      const parent = await tx.appointment.findUniqueOrThrow({ where: { id: visit.appointmentId } });
      const current = await tx.homeCollectionVisit.findUniqueOrThrow({ where: { id } });
      if (parent.mode !== "HOME_COLLECTION" || ["CANCELLED", "NO_SHOW"].includes(parent.status)) {
        throw new Error("APPOINTMENT_NOT_ACTIVE");
      }
      if (!manager && current.assignedCollectorUserId !== session.user.id) {
        throw new Error("ASSIGNED_COLLECTOR_REQUIRED");
      }
      if (current.updatedAt.getTime() !== visit.updatedAt.getTime() ||
          (nextStatus !== current.status && !(transitions[current.status] || []).includes(nextStatus))) {
        throw new Error("VISIT_STATE_CHANGED");
      }
      if (nextStatus === "CANCELLED" && ["COLLECTING", "COLLECTED", "DELIVERED"].includes(current.status)) {
        throw new Error("SPECIMEN_CUSTODY_ALREADY_STARTED");
      }
      if (["COLLECTING","COLLECTED","DELIVERED"].includes(nextStatus)) {
        if (!current.orderId) throw new Error("HOME_ORDER_LINK_REQUIRED");
        // Lock the accession as part of the same custody transaction. Concurrent
        // specimen collection always takes appointment then visit locks first.
        const accessionLock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM orders WHERE id = ${current.orderId}
          AND organization_id = ${session.user.organizationId}
          AND patient_id = ${parent.patientId}
          AND ordering_branch_id = ${current.branchId} FOR UPDATE
        `;
        if (accessionLock.length !== 1) throw new Error("HOME_ORDER_CHANGED");
        const order = await tx.labOrder.findFirst({
          where: { id: current.orderId,
            organizationId: session.user.organizationId,
            patientId: parent.patientId,
            orderingBranchId: current.branchId,
            status: { notIn: ["CANCELLED","DRAFT"] },
          },
          include: {
            invoices: { select: {
              status: true, currency: true, total: true, paidAmount: true, balanceAmount: true,
            } },
            specimens: { include: {
              collectionAttempts: { where: { homeCollectionVisitId: id },
                select: { outcome: true, homeCollectionVisitId: true,
                  collectionLocationType: true, collectorUserId: true } },
              receptionAssessments: { select: { branchId: true } },
            } },
          },
        });
        if (!order) throw new Error("HOME_ORDER_CHANGED");
        const invoices = order.invoices.map(invoice => ({
          ...invoice, total: invoice.total.toString(),
          paidAmount: invoice.paidAmount.toString(),
          balanceAmount: invoice.balanceAmount.toString(),
        }));
        const problem = nextStatus === "COLLECTING"
          ? homeCollectionStartError(current, order.specimens.length, invoices)
          : homeCollectionCustodyError(current, nextStatus, order.specimens, invoices);
        if (problem) throw new Error(problem.toUpperCase());
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
        newValues: { status: nextStatus, assignedCollectorUserId: collectorId, transportNotes,
          orderId: current.orderId, specimenCustodyVerified: ["COLLECTED","DELIVERED"].includes(nextStatus) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const codes = [
      "APPOINTMENT_NOT_ACTIVE", "APPOINTMENT_NOT_READY", "SPECIMEN_CUSTODY_ALREADY_STARTED",
      "ASSIGNED_COLLECTOR_REQUIRED", "HOME_ORDER_LINK_REQUIRED", "HOME_ORDER_CHANGED", "HOME_COLLECTOR_REQUIRED",
      "HOME_SPECIMENS_REQUIRED", "HOME_ISSUED_INVOICE_REQUIRED",
      "HOME_SPECIMEN_COLLECTION_EVIDENCE_MISSING", "HOME_SPECIMEN_NOT_COLLECTED",
      "HOME_SPECIMEN_RECEPTION_EVIDENCE_MISSING",
    ];
    return NextResponse.json({ error: codes.includes(reason) ? reason.toLowerCase() : "home_collection_state_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", visitStatus: nextStatus });
}
