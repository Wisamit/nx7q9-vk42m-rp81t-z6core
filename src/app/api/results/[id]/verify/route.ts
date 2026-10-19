import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { lockResultOrderState, ResultOrderStateChanged } from "@/lib/result-order-state";
import { resolveAnalyzerQcGate } from "@/lib/qc-gate";
import { notifyUsersWithPermission } from "@/lib/notifications";
import { validationSpecimenCustodyError } from "@/lib/result-validation-custody";
import { selectValidationPolicy, snapshotValidationPolicy, stageAfterTechnicalReview, type ValidationPolicySnapshot } from "@/lib/result-validation";
import { Prisma } from "../../../../../../generated/prisma/client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = rawBody as {
    confirmDeltaWarnings?: boolean;
    confirmQcWarnings?: boolean;
    notes?: string;
  };
  const session = await requirePermission("results.technical_review");
  const ctx = await requestContext();
  const { id } = await params;

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      performingBranch: true,
      specimen: true,
      reflexEvents: { where: { status: "PENDING" } },
      validationHoldEvents: { where: { status: "ACTIVE", severitySnapshot: "BLOCK" } },
      deltaReviewEvents: { where: { status: "PENDING" }, orderBy: { detectedAt: "asc" } },
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
  if (!canAccessDepartment(session, result.orderItem.test.departmentId)) return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  if (!["DRAFT", "ENTERED"].includes(result.status)) return NextResponse.json({ error: "result_not_verifiable", status: result.status }, { status: 409 });
  if (!["ENTRY", "TECHNICAL_REVIEW"].includes(result.validationStage)) {
    return NextResponse.json({ error: "result_not_pending_technical_review", validationStage: result.validationStage }, { status: 409 });
  }

  const expectedCount = result.microbiologySnapshot ? 1 : Math.max(1, result.orderItem.test.components.length);
  if (result.values.length !== expectedCount) {
    return NextResponse.json({ error: "result_incomplete", expectedCount, enteredCount: result.values.length }, { status: 409 });
  }

  const pendingReflex = result.reflexEvents.length;
  if (pendingReflex > 0) {
    return NextResponse.json({ error: "reflex_review_required", pendingReflex }, { status: 409 });
  }

  const blockingValidationHolds = result.validationHoldEvents.length;
  if (blockingValidationHolds > 0) {
    return NextResponse.json({ error: "validation_hold_review_required", blockingValidationHolds }, { status: 409 });
  }

  const qcGate = result.source === "ANALYZER" && result.analyzerId
    ? await resolveAnalyzerQcGate(prisma, {
        analyzerId: result.analyzerId,
        testId: result.orderItem.testId,
        componentIds: result.values
          .filter(value => !value.isCalculated && value.analyzerImportId)
          .map(value => value.componentId),
        asOf: new Date(),
      })
    : null;

  if (qcGate?.blocking) {
    return NextResponse.json({
      error: "qc_blocking_hold",
      qcStatus: qcGate.status,
      reasons: qcGate.reasons,
    }, { status: 409 });
  }
  if (qcGate?.warning && body.confirmQcWarnings !== true) {
    return NextResponse.json({
      error: "qc_warning_confirmation_required",
      qcStatus: qcGate.status,
      reasons: qcGate.reasons,
    }, { status: 409 });
  }

  const deltaExceeded = result.values.filter((value) => value.deltaEvaluation === "EXCEEDED");
  if (deltaExceeded.length > 0 && body.confirmDeltaWarnings !== true) {
    const components = result.deltaReviewEvents.length > 0
      ? result.deltaReviewEvents.map((event) => ({
          code: event.componentCodeSnapshot,
          value: event.currentValueSnapshot.toString(),
          previousValue: event.previousValueSnapshot?.toString() || null,
          deltaAbsolute: event.deltaAbsoluteSnapshot?.toString() || null,
          deltaPercent: event.deltaPercentSnapshot?.toString() || null,
          absoluteLimit: event.absoluteLimitSnapshot?.toString() || null,
          percentLimit: event.percentLimitSnapshot?.toString() || null,
        }))
      : deltaExceeded.map((value) => ({
          code: value.componentCodeSnapshot,
          value: value.displayValue,
          previousValue: value.previousValueSnapshot?.toString() || null,
          deltaAbsolute: value.deltaAbsoluteSnapshot?.toString() || null,
          deltaPercent: value.deltaPercentSnapshot?.toString() || null,
          absoluteLimit: value.deltaAbsoluteLimitSnapshot?.toString() || null,
          percentLimit: value.deltaPercentLimitSnapshot?.toString() || null,
        }));
    return NextResponse.json({
      error: "delta_review_confirmation_required",
      deltaExceededCount: deltaExceeded.length,
      components,
    }, { status: 409 });
  }

  const verifiedAt = new Date();
  const validationSnapshot = result.validationPolicySnapshot
    ? result.validationPolicySnapshot as unknown as ValidationPolicySnapshot
    : snapshotValidationPolicy(selectValidationPolicy(await prisma.resultValidationPolicy.findMany({
        where: {
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          effectiveFrom: { lte: verifiedAt },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: verifiedAt } }] },
            { OR: [{ branchId: null }, { branchId: result.performingBranchId }] },
          ],
        },
      }), {
        branchId: result.performingBranchId,
        testId: result.orderItem.testId,
        departmentId: result.orderItem.test.departmentId,
      }));
  const nextValidationStage = stageAfterTechnicalReview(validationSnapshot);
  const finalValidationComplete = nextValidationStage === "COMPLETE";
  const criticalValues = result.values.filter((value) => value.isCritical);
  const escalationPolicies = criticalValues.length > 0
    ? await prisma.criticalEscalationPolicy.findMany({
        where: {
          organizationId: session.user.organizationId,
          testId: result.orderItem.testId,
          status: "ACTIVE",
          effectiveFrom: { lte: verifiedAt },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: verifiedAt } }] },
            { OR: [{ branchId: null }, { branchId: result.performingBranchId }] },
          ],
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const escalationPolicy =
    escalationPolicies.find(policy => policy.branchId === result.performingBranchId)
    || escalationPolicies.find(policy => policy.branchId === null)
    || null;
  const acknowledgementDueAt = escalationPolicy
    ? new Date(verifiedAt.getTime() + escalationPolicy.acknowledgementMinutes * 60_000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const { orderStatus: freshOrderStatus } = await lockResultOrderState(tx, {
      organizationId: session.user.organizationId,
      orderId: result.orderItem.orderId,
      orderItemId: result.orderItemId,
      mode: "REVIEW",
    });
    if (result.specimenId) {
      // Serialize validation with specimen quarantine, rejection and transfers.
      const custody = await tx.$queryRaw<Array<{ id: string; status: string; current_branch_id: string | null }>>`
        SELECT id, status, current_branch_id FROM specimens
        WHERE id = ${result.specimenId} AND organization_id = ${session.user.organizationId}
        FOR UPDATE
      `;
      if (custody.length !== 1 || validationSpecimenCustodyError({
        status: custody[0].status,
        currentBranchId: custody[0].current_branch_id,
        performingBranchId: result.performingBranchId,
      })) throw new Error("RESULT_STATE_CHANGED");
    }
    // Claim this exact result revision before recording clinical review.
    // Two reviewers or a concurrent result edit cannot both validate the same snapshot.
    const claim = await tx.laboratoryResult.updateMany({
      where: {
        id: result.id,
        organizationId: session.user.organizationId,
        status: { in: ["DRAFT", "ENTERED"] },
        validationStage: { in: ["ENTRY", "TECHNICAL_REVIEW"] },
        updatedAt: result.updatedAt,
      },
      data: {
        status: finalValidationComplete ? "VERIFIED" : "ENTERED",
        validationStage: nextValidationStage,
        validationPolicyId: validationSnapshot.source === "CONFIGURED" ? validationSnapshot.policyId : null,
        validationPolicySnapshot: validationSnapshot as unknown as Prisma.InputJsonValue,
        technicalReviewedByUserId: session.user.id,
        technicalReviewedAt: verifiedAt,
        medicallyValidatedByUserId: null,
        medicallyValidatedAt: null,
        verifiedByUserId: finalValidationComplete ? session.user.id : null,
        verifiedAt: finalValidationComplete ? verifiedAt : null,
      },
    });

    if (claim.count !== 1) throw new Error("RESULT_STATE_CHANGED");

    // Result writers and Reflex reviewers serialize on this result record.
    // Pending decisions or new BLOCK holds arriving after UX preflight must
    // never be bypassed by the technical review transaction.
    const [liveReflexCount,liveBlockingHolds,liveValueCount]=await Promise.all([
      tx.reflexRuleEvent.count({where:{resultId:result.id,status:"PENDING"}}),
      tx.validationHoldEvent.count({where:{resultId:result.id,status:"ACTIVE",severitySnapshot:"BLOCK"}}),
      tx.laboratoryResultValue.count({where:{resultId:result.id}}),
    ]);
    if(liveReflexCount>0||liveBlockingHolds>0||liveValueCount!==expectedCount)
      throw new Error("RESULT_STATE_CHANGED");

    await tx.resultValidationReview.create({
      data: {
        resultId: result.id,
        stage: "TECHNICAL_REVIEW",
        outcome: "APPROVED",
        reviewerUserId: session.user.id,
        automated: false,
        reviewedAt: verifiedAt,
        notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null,
        policySnapshot: validationSnapshot as unknown as Prisma.InputJsonValue,
      },
    });

    if (deltaExceeded.length > 0 && body.confirmDeltaWarnings === true) {
      const acknowledgementNote = typeof body.notes === "string"
        ? body.notes.trim().slice(0, 1000) || null
        : null;

      for (const value of deltaExceeded) {
        if (value.valueNumeric === null) continue;
        await tx.deltaReviewEvent.upsert({
          where: {
            resultId_componentCodeSnapshot: {
              resultId: result.id,
              componentCodeSnapshot: value.componentCodeSnapshot,
            },
          },
          update: {
            status: "ACKNOWLEDGED",
            acknowledgedByUserId: session.user.id,
            acknowledgedAt: verifiedAt,
            acknowledgementNote,
            supersededAt: null,
          },
          create: {
            resultId: result.id,
            deltaRuleId: value.deltaRuleId,
            status: "ACKNOWLEDGED",
            componentCodeSnapshot: value.componentCodeSnapshot,
            componentNameEnSnapshot: value.componentNameEnSnapshot,
            componentNameArSnapshot: value.componentNameArSnapshot,
            currentValueSnapshot: value.valueNumeric,
            previousValueSnapshot: value.previousValueSnapshot,
            previousResultAtSnapshot: value.previousResultAtSnapshot,
            deltaAbsoluteSnapshot: value.deltaAbsoluteSnapshot,
            deltaPercentSnapshot: value.deltaPercentSnapshot,
            absoluteLimitSnapshot: value.deltaAbsoluteLimitSnapshot,
            percentLimitSnapshot: value.deltaPercentLimitSnapshot,
            lookbackDaysSnapshot: value.deltaLookbackDaysSnapshot,
            performingBranchIdSnapshot: result.performingBranchId,
            methodIdSnapshot: result.methodId,
            detectedAt: verifiedAt,
            acknowledgedByUserId: session.user.id,
            acknowledgedAt: verifiedAt,
            acknowledgementNote,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: result.performingBranchId,
          actorUserId: session.user.id,
          action: "DELTA_REVIEW_ACKNOWLEDGED",
          entityType: "LaboratoryResult",
          entityId: result.id,
          newValues: {
            deltaExceededCount: deltaExceeded.length,
            components: deltaExceeded.map(value => ({
              code: value.componentCodeSnapshot,
              currentValue: value.valueNumeric?.toString() || null,
              previousValue: value.previousValueSnapshot?.toString() || null,
              deltaAbsolute: value.deltaAbsoluteSnapshot?.toString() || null,
              deltaPercent: value.deltaPercentSnapshot?.toString() || null,
              absoluteLimit: value.deltaAbsoluteLimitSnapshot?.toString() || null,
              percentLimit: value.deltaPercentLimitSnapshot?.toString() || null,
              deltaRuleId: value.deltaRuleId,
              lookbackDays: value.deltaLookbackDaysSnapshot,
            })),
            acknowledgedAt: verifiedAt,
          },
          reason: acknowledgementNote || "Delta-check warnings reviewed during technical review",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }

    await tx.orderItem.update({
      where: { id: result.orderItemId },
      data: { status: finalValidationComplete ? "VERIFIED" : "IN_PROGRESS" },
    });

    if (criticalValues.length > 0) {
      await tx.criticalResultEvent.upsert({
        where: { resultId: result.id },
        update: {
          status: "OPEN",
          criticalValueSnapshot: criticalValues.map((value) => ({
            componentCode: value.componentCodeSnapshot,
            componentName: value.componentNameEnSnapshot,
            componentNameEn: value.componentNameEnSnapshot,
            componentNameAr: value.componentNameArSnapshot,
            displayValue: value.displayValue,
            valueTextEn: value.valueTextEnSnapshot,
            valueTextAr: value.valueTextArSnapshot,
            unit: value.unitSnapshot,
            flag: value.flag,
            flagSource: value.flagSource,
            isAbnormal: value.isAbnormal,
            qualitativeOptionId: value.qualitativeOptionId,
            qualitativeOptionCode: value.qualitativeOptionCodeSnapshot,
            criticalLow: value.criticalLowSnapshot?.toString() || null,
            criticalHigh: value.criticalHighSnapshot?.toString() || null,
          })),
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          closedAt: null,
          escalationPolicyId: escalationPolicy?.id || null,
          acknowledgementDueAt,
          escalationLevel: 0,
          nextEscalationDueAt: acknowledgementDueAt,
          maxEscalationLevelSnapshot: escalationPolicy?.maxEscalationLevel || null,
          escalationIntervalMinutesSnapshot: escalationPolicy?.escalationIntervalMinutes || null,
          requireReadBackSnapshot: escalationPolicy?.requireReadBack || false,
        },
        create: {
          resultId: result.id,
          status: "OPEN",
          escalationPolicyId: escalationPolicy?.id || null,
          acknowledgementDueAt,
          escalationLevel: 0,
          nextEscalationDueAt: acknowledgementDueAt,
          maxEscalationLevelSnapshot: escalationPolicy?.maxEscalationLevel || null,
          escalationIntervalMinutesSnapshot: escalationPolicy?.escalationIntervalMinutes || null,
          requireReadBackSnapshot: escalationPolicy?.requireReadBack || false,
          criticalValueSnapshot: criticalValues.map((value) => ({
            componentCode: value.componentCodeSnapshot,
            componentName: value.componentNameEnSnapshot,
            componentNameEn: value.componentNameEnSnapshot,
            componentNameAr: value.componentNameArSnapshot,
            displayValue: value.displayValue,
            valueTextEn: value.valueTextEnSnapshot,
            valueTextAr: value.valueTextArSnapshot,
            unit: value.unitSnapshot,
            flag: value.flag,
            flagSource: value.flagSource,
            isAbnormal: value.isAbnormal,
            qualitativeOptionId: value.qualitativeOptionId,
            qualitativeOptionCode: value.qualitativeOptionCodeSnapshot,
            criticalLow: value.criticalLowSnapshot?.toString() || null,
            criticalHigh: value.criticalHighSnapshot?.toString() || null,
          })),
        },
      });

      await notifyUsersWithPermission(tx, {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        permissionCode: "critical.communicate",
        eventCode: "CRITICAL_RESULT_OPENED",
        title: "Critical result requires acknowledgement",
        body: `${result.orderItem.order.accessionNumber} · ${result.orderItem.test.code} has ${criticalValues.length} critical value(s) requiring communication and acknowledgement.`,
        severity: "CRITICAL",
        entityType: "LaboratoryResult",
        entityId: result.id,
        metadata: {
          orderId: result.orderItem.orderId,
          orderItemId: result.orderItemId,
          testCode: result.orderItem.test.code,
          criticalCount: criticalValues.length,
          acknowledgementDueAt: acknowledgementDueAt?.toISOString() || null,
        },
      });
    }

    if (finalValidationComplete) {
      const remaining = await tx.orderItem.count({
        where: {
          orderId: result.orderItem.orderId,
          status: { notIn: ["VERIFIED", "CANCELLED"] },
        },
      });

      if (remaining === 0 && freshOrderStatus !== "COMPLETED") {
        const advanced = await tx.labOrder.updateMany({
          where: { id: result.orderItem.orderId, organizationId: session.user.organizationId,
            status: freshOrderStatus as "DRAFT" | "REGISTERED" | "COLLECTED" | "IN_PROGRESS" },
          data: { status: "COMPLETED" },
        });
        if (advanced.count !== 1) throw new ResultOrderStateChanged();
        await tx.orderStatusHistory.create({
          data: {
            orderId: result.orderItem.orderId,
            fromStatus: freshOrderStatus as "DRAFT" | "REGISTERED" | "COLLECTED" | "IN_PROGRESS",
            toStatus: "COMPLETED",
            reason: "All non-cancelled order items completed required validation",
            changedByUserId: session.user.id,
          },
        });
      }
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: "RESULT_TECHNICAL_REVIEWED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: { status: result.status },
        newValues: {
          status: finalValidationComplete ? "VERIFIED" : "ENTERED",
          validationStage: nextValidationStage,
          validationPolicy: validationSnapshot,
          technicalReviewedAt: verifiedAt,
          verifiedAt: finalValidationComplete ? verifiedAt : null,
          criticalCount: criticalValues.length,
          deltaExceededCount: deltaExceeded.length,
          deltaReviewAcknowledgedCount: body.confirmDeltaWarnings === true ? deltaExceeded.length : 0,
          blockingValidationHoldCount: blockingValidationHolds,
          qcGateStatus: qcGate?.status || null,
          qcGateReasons: qcGate?.reasons || [],
          qcWarningConfirmed: qcGate?.warning ? body.confirmQcWarnings === true : false,
          criticalEscalationPolicyId: escalationPolicy?.id || null,
          criticalAcknowledgementDueAt: acknowledgementDueAt,
          orderItemId: result.orderItemId,
          specimenId: result.specimenId,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { id: result.id, status: finalValidationComplete ? "VERIFIED" as const : "ENTERED" as const, validationStage: nextValidationStage };
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof ResultOrderStateChanged) return "ORDER_CLOSED" as const;
    if (error instanceof Error && error.message === "RESULT_STATE_CHANGED") return null;
    throw error;
  });
  if (updated === "ORDER_CLOSED") {
    return NextResponse.json({ error: "order_or_test_not_open_for_results" }, { status: 409 });
  }
  if (!updated) {
    return NextResponse.json({ error: "result_state_changed_retry" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    resultId: updated.id,
    resultStatus: updated.status,
    validationStage: updated.validationStage,
    medicalValidationRequired: validationSnapshot.requiresMedicalValidation,
    criticalCount: criticalValues.length,
    deltaExceededCount: deltaExceeded.length,
    releaseBlockedUntilCriticalAcknowledgement: criticalValues.length > 0,
  });
}
