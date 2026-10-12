import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext, canAccessBranch } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { homeOrderMatch } from "@/lib/home-collection-custody";

class LinkConflict extends Error {
  constructor(readonly reason: string, readonly statusCode = 409) { super(reason); }
}

/** Bind an existing priced LIS order to a scheduled home visit without modifying
 * clinical test names, invoices or existing specimen collection history. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("home_collection.manage");
  if (!permissionSet(session).has("orders.view"))
    return NextResponse.json({ error: "orders_view_required" }, { status: 403 });
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const orderId = body && typeof body === "object" && !Array.isArray(body)
    && typeof (body as { orderId?: unknown }).orderId === "string"
    ? (body as { orderId: string }).orderId.trim() : "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id) || !uuid.test(orderId))
    return NextResponse.json({ error: "invalid_order_or_visit" }, { status: 400 });
  const org = session.user.organizationId;
  const visit = await prisma.homeCollectionVisit.findFirst({
    where: { id, appointment: { organizationId: org } },
    include: { appointment: true },
  });
  if (!visit) return NextResponse.json({ error: "visit_not_found" }, { status: 404 });
  if (!canAccessBranch(session, visit.branchId) ||
    visit.appointment.branchId !== visit.branchId ||
    !session.user.branchScopes.some(b =>
      b.branchId === visit.branchId && b.branch.status === "ACTIVE" &&
      b.branch.organizationId === org)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  const ctx = await requestContext();
  try {
    const linked = await prisma.$transaction(async tx => {
      const lockedAppointment = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM appointments WHERE id = ${visit.appointmentId}
        AND organization_id = ${org} FOR UPDATE
      `;
      if (lockedAppointment.length !== 1) throw new LinkConflict("visit_not_found",404);
      const lockedVisit = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM home_collection_visits WHERE id = ${id}
        AND appointment_id = ${visit.appointmentId} FOR UPDATE
      `;
      if (lockedVisit.length !== 1) throw new LinkConflict("visit_changed");
      const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE id = ${orderId} AND organization_id = ${org}
        FOR UPDATE
      `;
      if (lockedOrder.length !== 1) throw new LinkConflict("order_not_found",404);
      const [freshVisit, order] = await Promise.all([
        tx.homeCollectionVisit.findUniqueOrThrow({
          where: { id }, include: { appointment: true },
        }),
        tx.labOrder.findFirst({
          where: { id: orderId, organizationId: org },
          include: { _count: { select: { items: true, specimens: true, invoices: true } } },
        }),
      ]);
      if (!order || freshVisit.appointment.mode !== "HOME_COLLECTION" ||
          freshVisit.appointment.status !== "CONFIRMED")
        throw new LinkConflict("order_or_booking_not_ready");
      const error = homeOrderMatch({
        orderOrganizationId: order.organizationId,
        visitOrganizationId: freshVisit.appointment.organizationId,
        orderPatientId: order.patientId,
        visitPatientId: freshVisit.appointment.patientId,
        orderingBranchId: order.orderingBranchId,
        visitBranchId: freshVisit.branchId,
        orderStatus: order.status, visitStatus: freshVisit.status,
        hasSpecimens: order._count.specimens > 0,
        hasOrderItems: order._count.items > 0,
        alreadyLinked: freshVisit.orderId !== null,
      });
      if (error) throw new LinkConflict(error);
      // A clinical accession must not be assigned to two home visits.
      const already = await tx.homeCollectionVisit.findUnique({
        where: { orderId }, select: { id: true },
      });
      if (already) throw new LinkConflict("home_order_already_linked_elsewhere");
      const changed = await tx.homeCollectionVisit.updateMany({
        where: { id, appointmentId: visit.appointmentId, status: freshVisit.status,
          orderId: null, updatedAt: freshVisit.updatedAt },
        data: { orderId, orderLinkedByUserId: session.user.id, orderLinkedAt: new Date() },
      });
      if (changed.count !== 1) throw new LinkConflict("visit_changed");
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: visit.branchId, actorUserId: session.user.id,
        action: "HOME_COLLECTION_ORDER_LINKED",
        entityType: "HomeCollectionVisit", entityId: id,
        newValues: {
          orderId, accessionNumber: order.accessionNumber, patientId: order.patientId,
          specimenCount: order._count.specimens, invoiceCount: order._count.invoices,
        },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { id, orderId, accessionNumber: order.accessionNumber };
    }, { isolationLevel: "Serializable", timeout: 45000 });
    return NextResponse.json({ status: "ok", linked }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof LinkConflict)
      return NextResponse.json({ error: error.reason }, { status: error.statusCode });
    return NextResponse.json({ error: "home_order_link_concurrent_conflict" }, { status: 409 });
  }
}
