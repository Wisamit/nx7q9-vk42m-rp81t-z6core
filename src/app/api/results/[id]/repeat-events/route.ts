import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.enter");
  const ctx = await requestContext();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { type?: unknown; reason?: unknown } | null;
  const type = body?.type === "RERUN" ? "RERUN" : body?.type === "REPEAT" ? "REPEAT" : null;
  const reason = text(body?.reason, 1000);

  if (!type || !reason) return NextResponse.json({ error: "type_and_reason_required" }, { status: 400 });

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      orderItem: {
        include: {
          order: { select: { orderingBranchId: true, accessionNumber: true } },
        },
      },
      specimen: { select: { id: true, currentBranchId: true, barcode: true } },
      repeatEvents: { orderBy: { requestedAt: "desc" }, take: 20 },
    },
  });

  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (result.status === "CANCELLED") {
    return NextResponse.json({ error: "cancelled_result_cannot_be_repeated" }, { status: 409 });
  }

  const event = await prisma.$transaction(async tx => {
    const created = await tx.resultRepeatEvent.create({
      data: {
        organizationId: session.user.organizationId,
        orderItemId: result.orderItemId,
        resultId: result.id,
        specimenId: result.specimenId,
        type,
        reason,
        requestedByUserId: session.user.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: type === "RERUN" ? "RESULT_RERUN_MARKED" : "RESULT_REPEAT_MARKED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: {
          status: result.status,
          priorRepeatEventCount: result.repeatEvents.length,
        },
        newValues: {
          type,
          reason,
          orderItemId: result.orderItemId,
          accessionNumber: result.orderItem.order.accessionNumber,
          specimenId: result.specimenId,
          specimenBarcode: result.specimen?.barcode || null,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });

  return NextResponse.json({ status: "ok", event }, { status: 201 });
}
