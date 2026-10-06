import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { id } = await params;

  const microbiologyCase = await prisma.microbiologyCase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { result: true, orderItem: { include: { test: { select: { departmentId: true } } } } },
  });

  if (!microbiologyCase) return NextResponse.json({ error: "microbiology_case_not_found" }, { status: 404 });
  if (!canAccessBranch(session, microbiologyCase.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, microbiologyCase.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (!microbiologyCase.result) {
    return NextResponse.json({ error: "microbiology_result_not_submitted" }, { status: 409 });
  }
  if (microbiologyCase.result.status !== "ENTERED") {
    return NextResponse.json({
      error: "only_unverified_microbiology_result_can_be_withdrawn",
      status: microbiologyCase.result.status,
    }, { status: 409 });
  }

  const withdrawnAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.laboratoryResult.update({
      where: { id: microbiologyCase.result!.id },
      data: { status: "CANCELLED" },
    });

    await tx.microbiologyCase.update({
      where: { id: microbiologyCase.id },
      data: {
        resultId: null,
        status: "IN_PROGRESS",
        finalizedByUserId: null,
        finalizedAt: null,
      },
    });

    await tx.orderItem.update({
      where: { id: microbiologyCase.orderItemId },
      data: { status: "IN_PROGRESS" },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_FINAL_SUBMISSION_WITHDRAWN",
        entityType: "LaboratoryResult",
        entityId: microbiologyCase.result!.id,
        oldValues: {
          status: "ENTERED",
          microbiologyCaseId: microbiologyCase.id,
          version: microbiologyCase.result!.version,
        },
        newValues: {
          status: "CANCELLED",
          microbiologyCaseStatus: "IN_PROGRESS",
          withdrawnAt,
        },
        reason: "Final microbiology submission withdrawn before verification for correction",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({
    status: "ok",
    withdrawnResultId: microbiologyCase.result.id,
    resultVersion: microbiologyCase.result.version,
    microbiologyCaseStatus: "IN_PROGRESS",
  });
}
