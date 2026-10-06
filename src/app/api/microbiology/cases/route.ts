import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const orderItemId = text(body.orderItemId, 36);
  const specimenId = text(body.specimenId, 36);
  const performingBranchId = text(body.performingBranchId, 36);
  if (!orderItemId || !specimenId || !performingBranchId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      order: { organizationId: session.user.organizationId },
    },
    include: {
      test: true,
      specimenLinks: { where: { specimenId }, include: { specimen: true } },
    },
  });
  if (!orderItem) return NextResponse.json({ error: "order_item_not_found" }, { status: 404 });
  if (!canAccessDepartment(session, orderItem.test.departmentId)) return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  if (orderItem.test.workflowType !== "MICROBIOLOGY") {
    return NextResponse.json({ error: "test_not_configured_for_microbiology" }, { status: 409 });
  }
  const specimen = orderItem.specimenLinks[0]?.specimen;
  if (!specimen) return NextResponse.json({ error: "specimen_not_linked_to_order_item" }, { status: 409 });
  if (!["RECEIVED","IN_PROCESS"].includes(specimen.status) || specimen.currentBranchId !== performingBranchId) {
    return NextResponse.json({ error: "specimen_not_ready_for_microbiology" }, { status: 409 });
  }

  const existing = await prisma.microbiologyCase.findUnique({
    where: { orderItemId_specimenId: { orderItemId, specimenId } },
  });
  if (existing) return NextResponse.json({ status: "ok", case: existing }, { status: 200 });

  const created = await prisma.$transaction(async tx => {
    const microbiologyCase = await tx.microbiologyCase.create({
      data: {
        organizationId: session.user.organizationId,
        orderItemId,
        specimenId,
        performingBranchId,
        status: "IN_PROGRESS",
        cultureStatus: "PENDING",
        createdByUserId: session.user.id,
      },
    });

    if (specimen.status === "RECEIVED") {
      await tx.specimen.update({ where: { id: specimen.id }, data: { status: "IN_PROCESS" } });
      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "PROCESSING_STARTED",
          branchId: performingBranchId,
          actorUserId: session.user.id,
          fromStatus: "RECEIVED",
          toStatus: "IN_PROCESS",
          details: { orderItemId, workflow: "MICROBIOLOGY" },
        },
      });
    }

    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { performedBranchId: performingBranchId, status: "IN_PROGRESS" },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_CASE_CREATED",
        entityType: "MicrobiologyCase",
        entityId: microbiologyCase.id,
        newValues: { orderItemId, specimenId, testId: orderItem.testId, cultureStatus: "PENDING" },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return microbiologyCase;
  });

  return NextResponse.json({ status: "ok", case: created }, { status: 201 });
}
