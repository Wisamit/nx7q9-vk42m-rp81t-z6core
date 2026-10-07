import { NextResponse } from "next/server";
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

    await tx.orderItemAnalyzerRouteEvent.create({
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
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });

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
