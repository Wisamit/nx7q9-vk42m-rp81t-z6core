import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveAnalyzerQcGate } from "@/lib/qc-gate";
import { validationSpecimenCustodyError } from "@/lib/result-validation-custody";
import { medicalReviewerAllowed, type ValidationPolicySnapshot } from "@/lib/result-validation";
import { Prisma } from "../../../../../../generated/prisma/client";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.medical_validate");
  const ctx = await requestContext();
  const { id } = await params;
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = rawBody as {
    action?: "APPROVE" | "RETURN";
    reason?: string;
    notes?: string;
    confirmQcWarnings?: boolean;
  };

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      validationHoldEvents: { where: { status: "ACTIVE", severitySnapshot: "BLOCK" } },
      orderItem: {
        include: {
          test: true,
          order: true,
        },
      },
    },
  });

  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!canAccessDepartment(session, result.orderItem.test.departmentId)) return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  if (result.status !== "ENTERED" || result.validationStage !== "MEDICAL_VALIDATION") {
    return NextResponse.json({
      error: "result_not_pending_medical_validation",
      status: result.status,
      validationStage: result.validationStage,
    }, { status: 409 });
  }
  if (!result.technicalReviewedAt) {
    return NextResponse.json({ error: "technical_review_required" }, { status: 409 });
  }

  const validationSnapshot = result.validationPolicySnapshot as unknown as ValidationPolicySnapshot | null;
  if (!validationSnapshot?.requiresMedicalValidation) {
    return NextResponse.json({ error: "medical_validation_not_required_by_snapshot" }, { status: 409 });
  }

  // Never infer clinical approval from malformed or missing action input.
  if (body.action !== "APPROVE" && body.action !== "RETURN") {
    return NextResponse.json({ error: "invalid_medical_validation_action" }, { status: 400 });
  }
  const action = body.action;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) || null : null;

  if (action === "RETURN") {
    if (!reason) return NextResponse.json({ error: "return_reason_required" }, { status: 400 });

    const returnedAt = new Date();
    const returned = await prisma.$transaction(async tx => {
      if (result.specimenId) {
        const custody = await tx.$queryRaw<Array<{ id: string; status: string; current_branch_id: string | null }>>`
          SELECT id, status, current_branch_id FROM specimens
          WHERE id = ${result.specimenId} AND organization_id = ${session.user.organizationId}
          FOR UPDATE
        `;
        // Returning a result for correction is a safety action, not an
        // approval. Permit return even when the specimen was quarantined or
        // transferred; only approval is gated on ready specimen custody.
        if (custody.length !== 1) throw new Error("RESULT_STATE_CHANGED");
      }
    const claimed = await tx.laboratoryResult.updateMany({
        where: {
          id: result.id,
          organizationId: session.user.organizationId,
          status: "ENTERED",
          validationStage: "MEDICAL_VALIDATION",
          updatedAt: result.updatedAt,
        },
        data: {
          status: "ENTERED",
          validationStage: "TECHNICAL_REVIEW",
          technicalReviewedByUserId: null,
          technicalReviewedAt: null,
          medicallyValidatedByUserId: null,
          medicallyValidatedAt: null,
          verifiedByUserId: null,
          verifiedAt: null,
          autoVerified: false,
          autoverificationPolicyId: null,
          autoverificationDecisionSnapshot: Prisma.DbNull,
        },
      });
      if (claimed.count !== 1) throw new Error("RESULT_STATE_CHANGED");
      await tx.resultValidationReview.create({
        data: {
          resultId: result.id,
          stage: "MEDICAL_VALIDATION",
          outcome: "RETURNED",
          reviewerUserId: session.user.id,
          automated: false,
          reviewedAt: returnedAt,
          notes: reason,
          policySnapshot: validationSnapshot as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.orderItem.update({
        where: { id: result.orderItemId },
        data: { status: "IN_PROGRESS" },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: result.performingBranchId,
          actorUserId: session.user.id,
          action: "RESULT_MEDICAL_VALIDATION_RETURNED",
          entityType: "LaboratoryResult",
          entityId: result.id,
          oldValues: {
            status: result.status,
            validationStage: result.validationStage,
            technicalReviewedByUserId: result.technicalReviewedByUserId,
            technicalReviewedAt: result.technicalReviewedAt,
          },
          newValues: {
            status: "ENTERED",
            validationStage: "TECHNICAL_REVIEW",
          },
          reason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return { status: "ENTERED" as const, validationStage: "TECHNICAL_REVIEW" as const };
    }).catch(error => {
      if (error instanceof Error && error.message === "RESULT_STATE_CHANGED") return null;
      throw error;
    });
    if (!returned) return NextResponse.json({ error: "result_state_changed_retry" }, { status: 409 });

    return NextResponse.json({
      status: "ok",
      action: "RETURNED",
      resultStatus: returned.status,
      validationStage: returned.validationStage,
    });
  }

  if (!medicalReviewerAllowed(validationSnapshot, result.technicalReviewedByUserId, session.user.id)) {
    return NextResponse.json({ error: "medical_validator_must_differ_from_technical_reviewer" }, { status: 409 });
  }

  if (result.validationHoldEvents.length > 0) {
    return NextResponse.json({
      error: "validation_hold_review_required",
      blockingValidationHolds: result.validationHoldEvents.length,
    }, { status: 409 });
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

  const validatedAt = new Date();
  const validated = await prisma.$transaction(async tx => {
    // Approval requires live, ready specimen custody. Returning for correction
    // is separately permitted even when the specimen has been quarantined.
    if (result.specimenId) {
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
    const claimed = await tx.laboratoryResult.updateMany({
      where: {
        id: result.id,
        organizationId: session.user.organizationId,
        status: "ENTERED",
        validationStage: "MEDICAL_VALIDATION",
        updatedAt: result.updatedAt,
      },
      data: {
        status: "VERIFIED",
        validationStage: "COMPLETE",
        medicallyValidatedByUserId: session.user.id,
        medicallyValidatedAt: validatedAt,
        verifiedByUserId: session.user.id,
        verifiedAt: validatedAt,
      },
    });
    if (claimed.count !== 1) throw new Error("RESULT_STATE_CHANGED");
    await tx.resultValidationReview.create({
      data: {
        resultId: result.id,
        stage: "MEDICAL_VALIDATION",
        outcome: "APPROVED",
        reviewerUserId: session.user.id,
        automated: false,
        reviewedAt: validatedAt,
        notes,
        policySnapshot: validationSnapshot as unknown as Prisma.InputJsonValue,
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
      await tx.labOrder.update({
        where: { id: result.orderItem.orderId },
        data: { status: "COMPLETED" },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: result.orderItem.orderId,
          fromStatus: result.orderItem.order.status,
          toStatus: "COMPLETED",
          reason: "All non-cancelled order items completed required validation",
          changedByUserId: session.user.id,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: "RESULT_MEDICALLY_VALIDATED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: {
          status: result.status,
          validationStage: result.validationStage,
        },
        newValues: {
          status: "VERIFIED",
          validationStage: "COMPLETE",
          medicallyValidatedAt: validatedAt,
          verifiedAt: validatedAt,
          validationPolicy: validationSnapshot,
          qcGateStatus: qcGate?.status || null,
          qcGateReasons: qcGate?.reasons || [],
          qcWarningConfirmed: qcGate?.warning ? body.confirmQcWarnings === true : false,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { status: "VERIFIED" as const, validationStage: "COMPLETE" as const };
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof Error && error.message === "RESULT_STATE_CHANGED") return null;
    throw error;
  });
  if (!validated) return NextResponse.json({ error: "result_state_changed_retry" }, { status: 409 });

  return NextResponse.json({
    status: "ok",
    action: "APPROVED",
    resultStatus: validated.status,
    validationStage: validated.validationStage,
  });
}
