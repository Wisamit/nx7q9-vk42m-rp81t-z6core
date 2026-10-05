import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildMicrobiologyDisplay } from "@/lib/microbiology-result";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { finalComment?: string };
  const finalComment = text(body.finalComment);

  const microbiologyCase = await prisma.microbiologyCase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      orderItem: {
        include: {
          test: true,
          results: { orderBy: { version: "desc" }, take: 1 },
        },
      },
      specimen: true,
      observations: { orderBy: { observedAt: "asc" } },
      isolates: {
        orderBy: { sequenceNumber: "asc" },
        include: {
          susceptibilityTests: {
            orderBy: { testedAt: "asc" },
            include: {
              results: { orderBy: { antibioticCodeSnapshot: "asc" } },
            },
          },
        },
      },
    },
  });

  if (!microbiologyCase) return NextResponse.json({ error: "microbiology_case_not_found" }, { status: 404 });
  if (!canAccessBranch(session, microbiologyCase.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (microbiologyCase.resultId) {
    return NextResponse.json({ error: "microbiology_case_already_submitted", resultId: microbiologyCase.resultId }, { status: 409 });
  }
  if (["FINAL","CANCELLED"].includes(microbiologyCase.status)) {
    return NextResponse.json({ error: "microbiology_case_locked", status: microbiologyCase.status }, { status: 409 });
  }
  if (microbiologyCase.cultureStatus === "PENDING") {
    return NextResponse.json({ error: "culture_status_pending" }, { status: 409 });
  }
  if (["GROWTH","MIXED_GROWTH"].includes(microbiologyCase.cultureStatus) && microbiologyCase.isolates.length === 0) {
    return NextResponse.json({ error: "growth_requires_isolate" }, { status: 409 });
  }
  if (microbiologyCase.orderItem.test.workflowType !== "MICROBIOLOGY") {
    return NextResponse.json({ error: "test_not_configured_for_microbiology" }, { status: 409 });
  }
  if (microbiologyCase.orderItem.results[0]) {
    return NextResponse.json({ error: "order_item_already_has_result", resultId: microbiologyCase.orderItem.results[0].id }, { status: 409 });
  }

  const displayValue = buildMicrobiologyDisplay({
    cultureStatus: microbiologyCase.cultureStatus,
    finalComment: finalComment || null,
    preliminaryComment: microbiologyCase.preliminaryComment,
    observations: microbiologyCase.observations.map(item => ({
      observationType: item.observationType,
      observationText: item.observationText,
    })),
    isolates: microbiologyCase.isolates.map(isolate => ({
      sequenceNumber: isolate.sequenceNumber,
      organismCodeSnapshot: isolate.organismCodeSnapshot,
      organismNameEnSnapshot: isolate.organismNameEnSnapshot,
      quantityText: isolate.quantityText,
      susceptibilityTests: isolate.susceptibilityTests.map(test => ({
        method: test.method,
        results: test.results.map(result => ({
          antibioticCodeSnapshot: result.antibioticCodeSnapshot,
          interpretation: result.interpretation,
          micValue: result.micValue,
          micUnit: result.micUnit,
          zoneDiameterMm: result.zoneDiameterMm,
        })),
      })),
    })),
  });

  const submittedAt = new Date();
  const saved = await prisma.$transaction(async tx => {
    const result = await tx.laboratoryResult.create({
      data: {
        organizationId: session.user.organizationId,
        orderItemId: microbiologyCase.orderItemId,
        specimenId: microbiologyCase.specimenId,
        performingBranchId: microbiologyCase.performingBranchId,
        methodId: microbiologyCase.orderItem.test.methodId,
        version: 1,
        status: "ENTERED",
        source: "MANUAL",
        enteredByUserId: session.user.id,
        enteredAt: submittedAt,
        comments: finalComment || microbiologyCase.preliminaryComment || null,
      },
    });

    await tx.laboratoryResultValue.create({
      data: {
        resultId: result.id,
        componentId: null,
        componentCodeSnapshot: microbiologyCase.orderItem.test.code,
        componentNameEnSnapshot: microbiologyCase.orderItem.test.nameEn,
        componentNameArSnapshot: microbiologyCase.orderItem.test.nameAr,
        resultTypeSnapshot: "TEXT",
        valueText: displayValue,
        displayValue,
        unitId: null,
        unitSnapshot: null,
        flag: "UNKNOWN",
        isCritical: false,
        deltaEvaluation: "NOT_CONFIGURED",
      },
    });

    await tx.microbiologyCase.update({
      where: { id: microbiologyCase.id },
      data: {
        resultId: result.id,
        status: "PRELIMINARY",
        finalComment: finalComment || null,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_RESULT_SUBMITTED",
        entityType: "MicrobiologyCase",
        entityId: microbiologyCase.id,
        oldValues: { status: microbiologyCase.status, resultId: null },
        newValues: {
          status: "PRELIMINARY",
          resultId: result.id,
          resultStatus: "ENTERED",
          cultureStatus: microbiologyCase.cultureStatus,
          isolateCount: microbiologyCase.isolates.length,
          submittedAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return result;
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    resultId: saved.id,
    resultStatus: saved.status,
    microbiologyCaseStatus: "PRELIMINARY",
  }, { status: 201 });
}
