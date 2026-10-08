import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyEditRejected, requireEditableMicrobiologyCase } from "@/lib/microbiology-case-lock";

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
  const withdrawn = await prisma.$transaction(async tx => {
    await requireEditableMicrobiologyCase(tx, {
      organizationId: session.user.organizationId,
      caseId: microbiologyCase.id,
      specimenId: microbiologyCase.specimenId,
      performingBranchId: microbiologyCase.performingBranchId,
      expectedCaseUpdatedAt: microbiologyCase.updatedAt,
      expectedResultId: microbiologyCase.result!.id,
      allowSubmittedResult: true,
      allowCorrectionWhenSpecimenUnready: true,
    });
    // A reviewer may have verified the result since the operator opened
    // this page. Only the same editable revision can be withdrawn.
    const claimed = await tx.laboratoryResult.updateMany({
      where: {
        id: microbiologyCase.result!.id,
        organizationId: session.user.organizationId,
        status: "ENTERED",
        validationStage: { in: ["ENTRY", "TECHNICAL_REVIEW"] },
        updatedAt: microbiologyCase.result!.updatedAt,
      },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) {
      throw new MicrobiologyEditRejected("microbiology_result_changed_or_under_review");
    }

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
  }).then(() => true).catch(error => {
    if (error instanceof MicrobiologyEditRejected) return error;
    throw error;
  });
  if (withdrawn instanceof MicrobiologyEditRejected) {
    return NextResponse.json({ error: withdrawn.code }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    withdrawnResultId: microbiologyCase.result.id,
    resultVersion: microbiologyCase.result.version,
    microbiologyCaseStatus: "IN_PROGRESS",
  });
}
