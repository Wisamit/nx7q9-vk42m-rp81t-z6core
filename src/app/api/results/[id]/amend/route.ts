import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { amendmentEligibility } from "@/lib/clinical-safety";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.amend");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { reason?: string } | null;
  const reason = text(body?.reason, 1000);

  if (!reason) return NextResponse.json({ error: "amendment_reason_required" }, { status: 400 });

  const original = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      orderItem: { include: { test: { select: { departmentId: true } } } },
    },
  });

  if (!original) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, original.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, original.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  const newer = await prisma.laboratoryResult.findFirst({
    where: {
      orderItemId: original.orderItemId,
      version: { gt: original.version },
      status: { notIn: ["CANCELLED","AMENDED"] },
    },
    orderBy: { version: "desc" },
  });
  const eligibility = amendmentEligibility({
    resultStatus: original.status,
    hasMicrobiologySnapshot: Boolean(original.microbiologySnapshot),
    newerResultExists: Boolean(newer),
  });
  if (!eligibility.allowed) {
    if (eligibility.error === "microbiology_requires_dedicated_amendment_workflow") {
      return NextResponse.json({ error: eligibility.error, resultId: original.id }, { status: 409 });
    }
    if (eligibility.error === "newer_result_version_already_exists" && newer) {
      return NextResponse.json({
        error: eligibility.error,
        resultId: newer.id,
        version: newer.version,
        status: newer.status,
      }, { status: 409 });
    }
    return NextResponse.json({ error: eligibility.error, status: original.status }, { status: 409 });
  }

  const amended = await prisma.$transaction(async (tx) => {
    const nextVersion = original.version + 1;
    const draft = await tx.laboratoryResult.create({
      data: {
        organizationId: original.organizationId,
        orderItemId: original.orderItemId,
        specimenId: original.specimenId,
        performingBranchId: original.performingBranchId,
        methodId: original.methodId,
        analyzerId: original.analyzerId,
        analyzerCodeSnapshot: original.analyzerCodeSnapshot,
        analyzerNameSnapshot: original.analyzerNameSnapshot,
        version: nextVersion,
        status: "DRAFT",
        source: "MANUAL",
        enteredByUserId: session.user.id,
        enteredAt: new Date(),
        amendedFromId: original.id,
        amendmentReason: reason,
        amendmentRequestedByUserId: session.user.id,
        amendmentRequestedAt: new Date(),
        comments: original.comments,
      },
    });

    for (const value of original.values) {
      await tx.laboratoryResultValue.create({
        data: {
          resultId: draft.id,
          componentId: value.componentId,
          componentCodeSnapshot: value.componentCodeSnapshot,
          componentNameEnSnapshot: value.componentNameEnSnapshot,
          componentNameArSnapshot: value.componentNameArSnapshot,
          resultTypeSnapshot: value.resultTypeSnapshot,
          valueNumeric: value.valueNumeric,
          valueText: value.valueText,
          valueBoolean: value.valueBoolean,
          valueDate: value.valueDate,
          displayValue: value.displayValue,
          unitId: value.unitId,
          unitSnapshot: value.unitSnapshot,
          referenceIntervalId: value.referenceIntervalId,
          referenceLowSnapshot: value.referenceLowSnapshot,
          referenceHighSnapshot: value.referenceHighSnapshot,
          referenceTextEnSnapshot: value.referenceTextEnSnapshot,
          referenceTextArSnapshot: value.referenceTextArSnapshot,
          criticalLowSnapshot: value.criticalLowSnapshot,
          criticalHighSnapshot: value.criticalHighSnapshot,
          flag: value.flag,
          isCritical: value.isCritical,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: original.performingBranchId,
        actorUserId: session.user.id,
        action: "RESULT_AMENDMENT_INITIATED",
        entityType: "LaboratoryResult",
        entityId: draft.id,
        oldValues: {
          releasedResultId: original.id,
          releasedVersion: original.version,
          releasedAt: original.releasedAt,
        },
        newValues: {
          amendmentResultId: draft.id,
          version: nextVersion,
          status: "DRAFT",
          amendedFromId: original.id,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return draft;
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    amendmentResultId: amended.id,
    version: amended.version,
    resultStatus: amended.status,
  }, { status: 201 });
}
