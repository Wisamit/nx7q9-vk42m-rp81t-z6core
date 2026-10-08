import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { analyzerCanRouteWorkItem } from "@/lib/analyzer-routing";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function loadOrderItem(orderItemId: string, organizationId: string) {
  return prisma.orderItem.findFirst({
    where: { id: orderItemId, order: { organizationId } },
    include: {
      test: true,
      order: { select: { accessionNumber: true } },
      specimenLinks: {
        where: { status: "ACTIVE" },
        include: { specimen: true },
      },
      analyzerRoutes: true,
      results: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, status: true, validationStage: true },
      },
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orderItemId: string }> }) {
  const session = await requirePermission("worklists.route");
  const ctx = await requestContext();
  const { orderItemId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const analyzerId = text(body.analyzerId, 36);
  if (!analyzerId) return NextResponse.json({ error: "analyzer_required" }, { status: 400 });

  const item = await loadOrderItem(orderItemId, session.user.organizationId);
  if (!item) return NextResponse.json({ error: "work_item_not_found" }, { status: 404 });
  if (!canAccessDepartment(session, item.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (item.status === "CANCELLED") {
    return NextResponse.json({ error: "work_item_cancelled" }, { status: 409 });
  }

  const latest = item.results[0];
  if (latest && ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(latest.status)) {
    return NextResponse.json({ error: "work_item_result_locked", status: latest.status }, { status: 409 });
  }
  if (latest?.validationStage === "COMPLETE") {
    return NextResponse.json({ error: "work_item_validation_complete" }, { status: 409 });
  }
  if (item.analyzerRoutes.some(route => route.analyzerId === analyzerId)) {
    return NextResponse.json({ error: "analyzer_already_assigned" }, { status: 409 });
  }

  const now = new Date();
  const analyzer = await prisma.analyzer.findFirst({
    where: {
      id: analyzerId,
      organizationId: session.user.organizationId,
      status: "ACTIVE",
    },
    include: {
      mappings: {
        where: {
          testId: item.testId,
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        select: { testId: true },
      },
    },
  });
  if (!analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const readySpecimenBranchIds = [...new Set(item.specimenLinks
    .map(link => link.specimen)
    .filter(specimen => ["RECEIVED","IN_PROCESS"].includes(specimen.status) && specimen.currentBranchId)
    .map(specimen => specimen.currentBranchId!))];

  const candidate = {
    analyzerId: analyzer.id,
    analyzerBranchId: analyzer.branchId,
    analyzerDepartmentId: analyzer.departmentId,
    mappedTestIds: [...new Set(analyzer.mappings.map(mapping => mapping.testId))],
  };

  if (!analyzerCanRouteWorkItem(candidate, {
    testId: item.testId,
    testDepartmentId: item.test.departmentId,
    readySpecimenBranchIds,
  })) {
    if (!readySpecimenBranchIds.includes(analyzer.branchId)) {
      return NextResponse.json({ error: "analyzer_specimen_branch_mismatch" }, { status: 409 });
    }
    if (analyzer.departmentId && item.test.departmentId && analyzer.departmentId !== item.test.departmentId) {
      return NextResponse.json({ error: "analyzer_department_mismatch" }, { status: 409 });
    }
    return NextResponse.json({ error: "active_analyzer_mapping_required" }, { status: 409 });
  }

  const route = await prisma.$transaction(async tx => {
    // Lock the order item so simultaneous route edits serialize and cannot
    // race clinical verification or changes to branch custody.
    const work = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT oi.id, oi.status FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ${item.id} AND o.organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (work.length !== 1 || work[0].status === "CANCELLED") throw new Error("ANALYZER_ROUTING_STATE_CHANGED");
    const ready = await tx.specimenOrderItem.findFirst({
      where: {
        orderItemId: item.id,
        status: "ACTIVE",
        specimen: {
          organizationId: session.user.organizationId,
          status: { in: ["RECEIVED", "IN_PROCESS"] },
          currentBranchId: analyzer.branchId,
        },
      },
      select: { specimenId: true, specimen: { select: { barcode: true } } },
    });
    const mapped = await tx.analyzerTestMapping.count({
      where: {
        analyzerId: analyzer.id,
        testId: item.testId,
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
    });
    const reviewed = await tx.laboratoryResult.count({
      where: {
        orderItemId: item.id,
        OR: [
          { status: { in: ["VERIFIED", "RELEASED", "AMENDED", "CANCELLED"] } },
          { validationStage: "COMPLETE" },
        ],
      },
    });
    if (!ready || mapped === 0 || reviewed > 0) throw new Error("ANALYZER_ROUTING_STATE_CHANGED");
    const created = await tx.orderItemAnalyzerRoute.create({
      data: {
        orderItemId: item.id,
        analyzerId: analyzer.id,
        assignedByUserId: session.user.id,
        analyzerCodeSnapshot: analyzer.code,
        analyzerNameSnapshot: analyzer.name,
        analyzerBranchIdSnapshot: analyzer.branchId,
      },
    });

    const assignment = await tx.orderItemAnalyzerRouteEvent.create({
      data: {
        orderItemId: item.id,
        analyzerId: analyzer.id,
        action: "ASSIGNED",
        analyzerCodeSnapshot: analyzer.code,
        analyzerNameSnapshot: analyzer.name,
        analyzerBranchIdSnapshot: analyzer.branchId,
        actorUserId: session.user.id,
      },
    });

    // Outbound transmission is opt-in per configured device. A single,
    // unambiguous approved analyzer test code is mandatory; never guess how
    // a mapped panel should be encoded on a physical instrument.
    let workOrderId: string | null = null;
    if (analyzer.bridgeDeviceKey) {
      const candidateMappings = await tx.analyzerTestMapping.findMany({
        where: {
          analyzerId: analyzer.id,
          testId: item.testId,
          status: "ACTIVE",
          approvalStatus: "APPROVED",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        select: { analyzerTestCode: true },
      });
      const codes = [...new Set(candidateMappings.map(mapping => mapping.analyzerTestCode))];
      if (codes.length === 1) {
        const outbound = await tx.analyzerWorkOrder.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: analyzer.branchId,
            analyzerId: analyzer.id,
            orderItemId: item.id,
            specimenId: ready.specimenId,
            assignmentEventId: assignment.id,
            accessionNumberSnapshot: item.order.accessionNumber,
            barcodeSnapshot: ready.specimen.barcode,
            testCodeSnapshot: item.testCodeSnapshot,
            analyzerTestCodeSnapshot: codes[0],
            bridgeDeviceKeySnapshot: analyzer.bridgeDeviceKey,
          },
        });
        workOrderId = outbound.id;
      }
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "ORDER_ITEM_ANALYZER_ASSIGNED",
        entityType: "OrderItem",
        entityId: item.id,
        newValues: {
          analyzerId: analyzer.id,
          analyzerCode: analyzer.code,
          analyzerName: analyzer.name,
          analyzerBranchId: analyzer.branchId,
          testId: item.testId,
          outboundWorkOrderId: workOrderId,
          outboundQueued: workOrderId !== null,
          outboundReason: workOrderId ? "QUEUED" : analyzer.bridgeDeviceKey ? "AMBIGUOUS_ANALYZER_TEST_CODE" : "BRIDGE_NOT_CONFIGURED",
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { ...created, workOrderId };
  }).catch(error => {
    if (error instanceof Error && error.message === "ANALYZER_ROUTING_STATE_CHANGED") return null;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  });
  if (!route) return NextResponse.json({ error: "analyzer_routing_state_changed" }, { status: 409 });

  return NextResponse.json({ status: "ok", route }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orderItemId: string }> }) {
  const session = await requirePermission("worklists.route");
  const ctx = await requestContext();
  const { orderItemId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const analyzerId = text(body.analyzerId, 36);
  const reason = text(body.reason, 1000);
  if (!analyzerId) return NextResponse.json({ error: "analyzer_required" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "clear_reason_required" }, { status: 400 });

  const item = await loadOrderItem(orderItemId, session.user.organizationId);
  if (!item) return NextResponse.json({ error: "work_item_not_found" }, { status: 404 });
  if (!canAccessDepartment(session, item.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }

  const route = item.analyzerRoutes.find(existing => existing.analyzerId === analyzerId);
  if (!route) return NextResponse.json({ error: "analyzer_route_not_found" }, { status: 404 });
  if (!canAccessBranch(session, route.analyzerBranchIdSnapshot)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const latest = item.results[0];
  if (latest && ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(latest.status)) {
    return NextResponse.json({ error: "work_item_result_locked", status: latest.status }, { status: 409 });
  }
  if (latest?.validationStage === "COMPLETE") {
    return NextResponse.json({ error: "work_item_validation_complete" }, { status: 409 });
  }

  await prisma.$transaction(async tx => {
    await tx.orderItemAnalyzerRoute.delete({
      where: { orderItemId_analyzerId: { orderItemId: item.id, analyzerId } },
    });

    await tx.orderItemAnalyzerRouteEvent.create({
      data: {
        orderItemId: item.id,
        analyzerId,
        action: "CLEARED",
        analyzerCodeSnapshot: route.analyzerCodeSnapshot,
        analyzerNameSnapshot: route.analyzerNameSnapshot,
        analyzerBranchIdSnapshot: route.analyzerBranchIdSnapshot,
        actorUserId: session.user.id,
        reason,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: route.analyzerBranchIdSnapshot,
        actorUserId: session.user.id,
        action: "ORDER_ITEM_ANALYZER_CLEARED",
        entityType: "OrderItem",
        entityId: item.id,
        oldValues: {
          analyzerId,
          analyzerCode: route.analyzerCodeSnapshot,
          analyzerName: route.analyzerNameSnapshot,
          analyzerBranchId: route.analyzerBranchIdSnapshot,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
