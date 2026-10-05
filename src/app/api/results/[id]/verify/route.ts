import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.verify");
  const ctx = await requestContext();
  const { id } = await params;

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      performingBranch: true,
      specimen: true,
      orderItem: {
        include: {
          test: { include: { components: { where: { status: "ACTIVE" } } } },
          order: { include: { items: true } },
        },
      },
    },
  });

  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!["DRAFT", "ENTERED"].includes(result.status)) return NextResponse.json({ error: "result_not_verifiable", status: result.status }, { status: 409 });

  const expectedCount = Math.max(1, result.orderItem.test.components.length);
  if (result.values.length !== expectedCount) {
    return NextResponse.json({ error: "result_incomplete", expectedCount, enteredCount: result.values.length }, { status: 409 });
  }

  const verifiedAt = new Date();
  const criticalValues = result.values.filter((value) => value.isCritical);

  const updated = await prisma.$transaction(async (tx) => {
    const verified = await tx.laboratoryResult.update({
      where: { id: result.id },
      data: {
        status: "VERIFIED",
        verifiedByUserId: session.user.id,
        verifiedAt,
      },
    });

    await tx.orderItem.update({
      where: { id: result.orderItemId },
      data: { status: "VERIFIED" },
    });

    const remaining = await tx.orderItem.count({
      where: {
        orderId: result.orderItem.orderId,
        status: { notIn: ["VERIFIED", "CANCELLED"] },
      },
    });

    if (remaining === 0 && result.orderItem.order.status !== "COMPLETED") {
      await tx.labOrder.update({ where: { id: result.orderItem.orderId }, data: { status: "COMPLETED" } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: result.orderItem.orderId,
          fromStatus: result.orderItem.order.status,
          toStatus: "COMPLETED",
          reason: "All non-cancelled order items verified",
          changedByUserId: session.user.id,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: "RESULT_VERIFIED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: { status: result.status },
        newValues: {
          status: "VERIFIED",
          verifiedAt,
          criticalCount: criticalValues.length,
          orderItemId: result.orderItemId,
          specimenId: result.specimenId,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return verified;
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    resultId: updated.id,
    resultStatus: updated.status,
    criticalCount: criticalValues.length,
    releaseBlockedUntilCriticalAcknowledgement: criticalValues.length > 0,
  });
}
