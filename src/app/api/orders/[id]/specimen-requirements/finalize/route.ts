import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.collect");
  const { id } = await params;

  const order = await prisma.labOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      specimens: {
        include: {
          events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
          orderItems: { include: { orderItem: { select: { testCodeSnapshot: true } } } },
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  if (!canAccessBranch(session, order.orderingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "cancelled_order_requirements_not_finalizable" }, { status: 409 });
  }

  const unresolved = order.specimens.filter(specimen => !specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .some(Boolean));

  if (unresolved.length === 0) {
    return NextResponse.json({
      status: "ok",
      finalized: 0,
      alreadyFinalized: order.specimens.length,
      source: "IMMUTABLE_ORDER_TIME_SNAPSHOT",
    });
  }

  const nonPlanned = unresolved.find(specimen => specimen.status !== "PLANNED");
  if (nonPlanned) {
    return NextResponse.json({
      error: "non_planned_specimen_without_requirement_snapshot",
      specimenId: nonPlanned.id,
      barcode: nonPlanned.barcode,
    }, { status: 409 });
  }

  return NextResponse.json({
    error: "order_time_specimen_requirement_snapshot_missing",
    message: "Current catalog values are not substituted for missing historical collection requirements.",
    specimenIds: unresolved.map(specimen => specimen.id),
    barcodes: unresolved.map(specimen => specimen.barcode),
    testCodes: [...new Set(unresolved.flatMap(specimen => specimen.orderItems.map(link => link.orderItem.testCodeSnapshot)))],
  }, { status: 409 });
}
