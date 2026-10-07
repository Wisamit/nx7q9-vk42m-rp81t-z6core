import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validationHoldMatches } from "@/lib/validation-holds";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { finalComment?: string } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const finalComment = text(body.finalComment, 5000);
  if (!finalComment) return NextResponse.json({ error: "final_comment_required" }, { status: 400 });

  const microbiologyCase = await prisma.microbiologyCase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      orderItem: {
        include: {
          test: {
            include: {
              validationHoldRules: {
                where: {
                  status: "ACTIVE",
                  effectiveFrom: { lte: new Date() },
                  AND: [
                    { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
                  ],
                },
              },
            },
          },
          results: { orderBy: { version: "desc" }, take: 1 },
        },
      },
      specimen: true,
      observations: { orderBy: { observedAt: "asc" } },
      isolates: {
        include: {
          organism: true,
          susceptibilityTests: {
            include: {
              results: { include: { antibiotic: true }, orderBy: { antibioticCodeSnapshot: "asc" } },
            },
            orderBy: { testedAt: "asc" },
          },
        },
        orderBy: { sequenceNumber: "asc" },
      },
      result: true,
    },
  });

  if (!microbiologyCase) return NextResponse.json({ error: "microbiology_case_not_found" }, { status: 404 });
  if (!canAccessBranch(session, microbiologyCase.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, microbiologyCase.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (microbiologyCase.status === "CANCELLED") {
    return NextResponse.json({ error: "microbiology_case_cancelled" }, { status: 409 });
  }
  if (microbiologyCase.cultureStatus === "PENDING") {
    return NextResponse.json({ error: "culture_status_must_be_finalized" }, { status: 409 });
  }
  if (["GROWTH", "MIXED_GROWTH"].includes(microbiologyCase.cultureStatus) && microbiologyCase.isolates.length === 0) {
    return NextResponse.json({ error: "growth_requires_at_least_one_isolate" }, { status: 409 });
  }

  const linkedResult = microbiologyCase.result;
  if (linkedResult && ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(linkedResult.status)) {
    return NextResponse.json({
      error: "microbiology_result_locked_requires_amendment",
      resultId: linkedResult.id,
      status: linkedResult.status,
    }, { status: 409 });
  }

  const latestResult = microbiologyCase.orderItem.results[0] || null;
  if (latestResult && (!linkedResult || latestResult.id !== linkedResult.id) && latestResult.status !== "CANCELLED") {
    return NextResponse.json({
      error: "order_item_already_has_separate_result_version",
      resultId: latestResult.id,
      version: latestResult.version,
      status: latestResult.status,
    }, { status: 409 });
  }
  const nextVersion = linkedResult?.version || ((latestResult?.version || 0) + 1);

  const snapshot = {
    schemaVersion: 1,
    caseId: microbiologyCase.id,
    cultureStatus: microbiologyCase.cultureStatus,
    preliminaryComment: microbiologyCase.preliminaryComment,
    finalComment,
    observations: microbiologyCase.observations.map(item => ({
      type: item.observationType,
      text: item.observationText,
      observedAt: item.observedAt.toISOString(),
    })),
    isolates: microbiologyCase.isolates.map(isolate => ({
      sequenceNumber: isolate.sequenceNumber,
      organism: {
        id: isolate.organism.id,
        code: isolate.organism.code,
        nameEn: isolate.organism.nameEn,
        nameAr: isolate.organism.nameAr,
      },
      quantityText: isolate.quantityText,
      colonyNotes: isolate.colonyNotes,
      susceptibilityTests: isolate.susceptibilityTests.map(test => ({
        method: test.method,
        comments: test.comments,
        testedAt: test.testedAt.toISOString(),
        results: test.results.map(result => ({
          antibioticId: result.antibioticId,
          antibioticCode: result.antibioticCodeSnapshot,
          antibioticNameEn: result.antibioticNameEnSnapshot,
          antibioticNameAr: result.antibioticNameArSnapshot,
          interpretation: result.interpretation,
          micValue: result.micValue?.toString() || null,
          micUnit: result.micUnit,
          zoneDiameterMm: result.zoneDiameterMm?.toString() || null,
          breakpointSnapshot: result.breakpointSnapshot,
        })),
      })),
    })),
  };

  const isolateSummary = microbiologyCase.isolates.map(isolate =>
    `#${isolate.sequenceNumber} ${isolate.organism.nameEn}${isolate.quantityText ? " (" + isolate.quantityText + ")" : ""}`
  ).join("; ");
  const summary = microbiologyCase.cultureStatus === "NO_GROWTH"
    ? "No growth"
    : [microbiologyCase.cultureStatus.replaceAll("_", " "), isolateSummary].filter(Boolean).join(": ");
  const displayValue = summary.slice(0, 1000);

  const saved = await prisma.$transaction(async tx => {
    const result = linkedResult
      ? await tx.laboratoryResult.update({
          where: { id: linkedResult.id },
          data: {
            specimenId: microbiologyCase.specimenId,
            performingBranchId: microbiologyCase.performingBranchId,
            status: "ENTERED",
            source: "MANUAL",
            enteredByUserId: session.user.id,
            enteredAt: new Date(),
            comments: finalComment,
            microbiologySnapshot: snapshot as Prisma.InputJsonValue,
            autoVerified: false,
            autoverificationPolicyId: null,
            autoverificationDecisionSnapshot: {
              eligible: false,
              policyId: null,
              reasons: ["MICROBIOLOGY_REQUIRES_MANUAL_VERIFICATION"],
            },
          },
        })
      : await tx.laboratoryResult.create({
          data: {
            organizationId: session.user.organizationId,
            orderItemId: microbiologyCase.orderItemId,
            specimenId: microbiologyCase.specimenId,
            performingBranchId: microbiologyCase.performingBranchId,
            methodId: microbiologyCase.orderItem.test.methodId,
            version: nextVersion,
            status: "ENTERED",
            source: "MANUAL",
            enteredByUserId: session.user.id,
            comments: finalComment,
            microbiologySnapshot: snapshot as Prisma.InputJsonValue,
            autoverificationDecisionSnapshot: {
              eligible: false,
              policyId: null,
              reasons: ["MICROBIOLOGY_REQUIRES_MANUAL_VERIFICATION"],
            },
          },
        });

    await tx.laboratoryResultValue.deleteMany({ where: { resultId: result.id } });
    await tx.laboratoryResultValue.create({
      data: {
        resultId: result.id,
        componentId: null,
        componentCodeSnapshot: microbiologyCase.orderItem.test.code,
        componentNameEnSnapshot: microbiologyCase.orderItem.test.nameEn,
        componentNameArSnapshot: microbiologyCase.orderItem.test.nameAr,
        resultTypeSnapshot: "TEXT",
        valueText: summary,
        displayValue,
        flag: "UNKNOWN",
        isAbnormal: false,
        isCritical: false,
        deltaEvaluation: "NOT_CONFIGURED",
      },
    });

    for (const rule of microbiologyCase.orderItem.test.validationHoldRules) {
      if (rule.branchId && rule.branchId !== microbiologyCase.performingBranchId) continue;
      const matched = validationHoldMatches(rule, {
        source: "MANUAL",
        values: [{ flag: "UNKNOWN", isAbnormal: false, isCritical: false, deltaEvaluation: "NOT_CONFIGURED" }],
      });

      if (matched) {
        await tx.validationHoldEvent.upsert({
          where: { resultId_ruleId: { resultId: result.id, ruleId: rule.id } },
          update: {
            status: "ACTIVE",
            severitySnapshot: rule.severity,
            reasonEnSnapshot: rule.reasonEn,
            reasonArSnapshot: rule.reasonAr,
            reviewedByUserId: null,
            reviewedAt: null,
            reviewNote: null,
          },
          create: {
            resultId: result.id,
            ruleId: rule.id,
            severitySnapshot: rule.severity,
            reasonEnSnapshot: rule.reasonEn,
            reasonArSnapshot: rule.reasonAr,
          },
        });
      } else {
        await tx.validationHoldEvent.updateMany({
          where: { resultId: result.id, ruleId: rule.id, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });
      }
    }

    await tx.microbiologyCase.update({
      where: { id: microbiologyCase.id },
      data: {
        resultId: result.id,
        finalComment,
        status: "PRELIMINARY",
        finalizedByUserId: null,
        finalizedAt: null,
      },
    });

    await tx.orderItem.update({
      where: { id: microbiologyCase.orderItemId },
      data: {
        performedBranchId: microbiologyCase.performingBranchId,
        status: "RESULTED",
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: linkedResult ? "MICROBIOLOGY_FINAL_RESULT_UPDATED" : "MICROBIOLOGY_FINAL_RESULT_SUBMITTED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: linkedResult ? { status: linkedResult.status, microbiologyCaseStatus: microbiologyCase.status } : undefined,
        newValues: {
          status: "ENTERED",
          microbiologyCaseId: microbiologyCase.id,
          cultureStatus: microbiologyCase.cultureStatus,
          isolateCount: microbiologyCase.isolates.length,
          snapshotSchemaVersion: 1,
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
  }, { status: linkedResult ? 200 : 201 });
}
