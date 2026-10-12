import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildDiagnosticReportSnapshot } from "@/lib/report-snapshot";
import { resolveAnalyzerQcGate } from "@/lib/qc-gate";
import { queueReportIntegrations } from "@/lib/integration-outbox";
import { resolveEffectiveReportTemplate } from "@/lib/report-template";
import { releaseEligibility } from "@/lib/clinical-safety";
import { consumeStaffStepUp, StaffStepUpError } from "@/lib/staff-step-up";

class SpecimenClinicalHold extends Error {}
class ReportReleaseStateChanged extends Error {}
class AnalyzerQcClinicalHold extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.release");
  const ctx = await requestContext();
  const { id } = await params;

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      criticalEvents: { include: { communications: true } },
      microbiologyCase: true,
      orderItem: { include: { order: true, test: { select: { departmentId: true } } } },
    },
  });

  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, result.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (result.validationStage !== "COMPLETE") {
    return NextResponse.json({
      error: "required_validation_not_complete",
      status: result.status,
      validationStage: result.validationStage,
    }, { status: 409 });
  }
  const analyzerComponentIds = result.values
    .filter(value => !value.isCalculated && value.analyzerImportId)
    .map(value => value.componentId);
  if (result.source === "ANALYZER" && (!result.analyzerId || analyzerComponentIds.length === 0)) {
    return NextResponse.json({
      error: "qc_release_blocked",
      qcStatus: "BLOCK",
      reasons: [{ code: "ANALYZER_RESULT_PROVENANCE_MISSING", componentId: null }],
    }, { status: 409 });
  }
  const qcGate = result.source === "ANALYZER" && result.analyzerId
    ? await resolveAnalyzerQcGate(prisma, {
        analyzerId: result.analyzerId,
        testId: result.orderItem.testId,
        componentIds: analyzerComponentIds,
        asOf: new Date(),
      })
    : null;

  let committedQcGate = qcGate;

  const criticalValues = result.values.filter((value) => value.isCritical);
  const criticalEvent = result.criticalEvents[0] || null;
  const eligibility = releaseEligibility({
    resultStatus: result.status,
    qcBlocking: Boolean(qcGate?.blocking),
    criticalCount: criticalValues.length,
    criticalEventStatus: criticalEvent?.status || null,
  });
  if (!eligibility.allowed) {
    if (eligibility.error === "qc_release_blocked") {
      return NextResponse.json({
        error: eligibility.error,
        qcStatus: qcGate?.status || "BLOCK",
        reasons: qcGate?.reasons || [],
      }, { status: 409 });
    }
    if (eligibility.error === "critical_acknowledgement_required") {
      return NextResponse.json({
        error: eligibility.error,
        criticalCount: criticalValues.length,
      }, { status: 409 });
    }
    return NextResponse.json({ error: eligibility.error, status: result.status }, { status: 409 });
  }

  const releasedAt = new Date();

  const released = await prisma.$transaction(async (tx) => {
    // Lock related specimens before releasing. A failed reception may place
    // material into quarantine; release must fail closed even for a result
    // that was verified before the reception exception was recorded.
    const associatedSpecimens = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT DISTINCT s.id, s.status FROM specimens s
      LEFT JOIN specimen_order_items soi ON soi.specimen_id = s.id
      WHERE s.organization_id = ${session.user.organizationId}
        AND (
          s.id = ${result.specimenId || ""}
          OR (soi.order_item_id = ${result.orderItemId} AND soi.status = 'ACTIVE')
        )
      ORDER BY s.id FOR UPDATE
    `;
    if (associatedSpecimens.some(specimen => specimen.status === "QUARANTINED")) {
      throw new SpecimenClinicalHold();
    }
    if (result.source === "ANALYZER" && result.analyzerId) {
      // Share the analyzer lock with QC run/target writes and the equipment lock
      // with downtime transitions. Preflight QC checks alone are race-prone.
      const analyzerLocks = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM analyzers
        WHERE id = ${result.analyzerId} AND organization_id = ${session.user.organizationId}
        FOR UPDATE
      `;
      if (analyzerLocks.length !== 1) throw new AnalyzerQcClinicalHold();
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM equipment
        WHERE analyzer_id = ${result.analyzerId} AND organization_id = ${session.user.organizationId}
        FOR UPDATE
      `;
      committedQcGate = await resolveAnalyzerQcGate(tx, {
        analyzerId: result.analyzerId,
        testId: result.orderItem.testId,
        componentIds: analyzerComponentIds,
        asOf: releasedAt,
      });
      if (committedQcGate.blocking) throw new AnalyzerQcClinicalHold();
    }
    // A second release request must not create a new report version from
    // an already-released result or a stale validation snapshot.
    const stepUp=await consumeStaffStepUp(tx,{
      token:request.headers.get("x-staff-step-up-token"),action:"RESULT_RELEASE",
      resourceKey:result.id,sessionId:session.id,userId:session.user.id,
      organizationId:session.user.organizationId,branchId:result.performingBranchId,
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    });
    const claim = await tx.laboratoryResult.updateMany({
      where: {
        id: result.id,
        organizationId: session.user.organizationId,
        status: "VERIFIED",
        validationStage: "COMPLETE",
        updatedAt: result.updatedAt,
      },
      data: {
        status: "RELEASED",
        releasedByUserId: session.user.id,
        releasedAt,
      },
    });
    if (claim.count !== 1) throw new ReportReleaseStateChanged();
    const updatedResult = await tx.laboratoryResult.findUniqueOrThrow({
      where: { id: result.id },
    });

    if (result.amendedFromId) {
      await tx.laboratoryResult.updateMany({
        where: { id: result.amendedFromId, status: "RELEASED" },
        data: { status: "AMENDED" },
      });
    }

    if (result.microbiologyCase) {
      await tx.microbiologyCase.update({
        where: { id: result.microbiologyCase.id },
        data: {
          status: "FINAL",
          finalizedByUserId: session.user.id,
          finalizedAt: releasedAt,
        },
      });
    }

    if (criticalEvent) {
      await tx.criticalResultEvent.update({
        where: { id: criticalEvent.id },
        data: {
          status: "CLOSED",
          closedAt: releasedAt,
        },
      });
    }

    const report = await tx.diagnosticReport.upsert({
      where: { orderId: result.orderItem.orderId },
      update: {},
      create: {
        organizationId: session.user.organizationId,
        orderId: result.orderItem.orderId,
      },
    });

    // Different tests from one order can be released simultaneously.
    // Serialize report version allocation on their shared report parent.
    const lockedReport = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM diagnostic_reports
      WHERE id = ${report.id} AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (lockedReport.length !== 1) throw new ReportReleaseStateChanged();

    const previousVersion = await tx.diagnosticReportVersion.findFirst({
      where: { reportId: report.id },
      orderBy: { version: "desc" },
    });

    // Serialize interpretation review with release snapshot construction:
    // neither a concurrent approval nor a replacement review can change
    // the approved clinical text halfway through a report version issue.
    const lockedOrderForInterpretation = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders
      WHERE id = ${result.orderItem.orderId}
        AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (lockedOrderForInterpretation.length !== 1) throw new ReportReleaseStateChanged();

    const snapshot = await buildDiagnosticReportSnapshot(tx, result.orderItem.orderId);
    const effectiveTemplate = await resolveEffectiveReportTemplate(tx, {
      organizationId: session.user.organizationId,
      branchId: result.orderItem.order.orderingBranchId,
      asOf: releasedAt,
    });
    const version = (previousVersion?.version || 0) + 1;
    const reportStatus = result.amendedFromId
      ? "AMENDED"
      : snapshot.allReleased ? "FINAL" : "PARTIAL";

    const reportVersion = await tx.diagnosticReportVersion.create({
      data: {
        reportId: report.id,
        version,
        status: reportStatus,
        branchId: result.orderItem.order.orderingBranchId,
        contentSnapshot: snapshot.contentSnapshot,
        resultVersionSnapshot: snapshot.resultVersionSnapshot,
        reportTemplateVersionId: effectiveTemplate?.version.id || null,
        templateSnapshot: effectiveTemplate ? {
          templateId: effectiveTemplate.template.id,
          templateCode: effectiveTemplate.template.code,
          templateNameEn: effectiveTemplate.template.nameEn,
          templateNameAr: effectiveTemplate.template.nameAr,
          templateVersion: effectiveTemplate.version.version,
          configuration: effectiveTemplate.configuration,
        } : undefined,
        verificationToken: randomBytes(32).toString("hex"),
        issuedByUserId: session.user.id,
        issuedAt: releasedAt,
        supersedesVersionId: previousVersion?.id || null,
        amendmentReason: result.amendmentReason || null,
      },
    });

    await tx.diagnosticReport.update({
      where: { id: report.id },
      data: { currentVersion: version },
    });

    const integrationQueue = await queueReportIntegrations(tx, {
      organizationId: session.user.organizationId,
      branchId: result.orderItem.order.orderingBranchId,
      orderId: result.orderItem.orderId,
      reportVersionId: reportVersion.id,
      reportVersion: version,
      reportStatus,
      issuedAt: releasedAt,
      snapshot: snapshot.contentSnapshot,
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: result.amendedFromId ? "RESULT_AMENDMENT_RELEASED" : "RESULT_RELEASED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: { status: "VERIFIED" },
        newValues: {
          status: "RELEASED",
          releasedAt,
          reportId: report.id,
          reportVersionId: reportVersion.id,
          reportVersion: version,
          reportStatus,
          reportTemplateVersionId: effectiveTemplate?.version.id || null,
          reportTemplateCode: effectiveTemplate?.template.code || null,
          amendedFromId: result.amendedFromId,
          microbiologyCaseId: result.microbiologyCase?.id || null,
          qcGateStatus: committedQcGate?.status || null,
          qcGateReasons: committedQcGate?.reasons || [],
          integrationQueue,
          stepUpGrantId:stepUp.grantId,stepUpProofMethod:stepUp.proofMethod,
        },
        reason: result.amendmentReason || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      updatedResult,
      reportId: report.id,
      reportVersionId: reportVersion.id,
      reportVersion: version,
      reportStatus,
      integrationQueue,
    };
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof StaffStepUpError) return "STEP_UP_REQUIRED" as const;
    if (error instanceof SpecimenClinicalHold) return "CLINICAL_HOLD" as const;
    if (error instanceof ReportReleaseStateChanged) return "RELEASE_STATE_CHANGED" as const;
    if (error instanceof AnalyzerQcClinicalHold) return "QC_HOLD" as const;
    throw error;
  });
  if (released === "STEP_UP_REQUIRED")
    return NextResponse.json({error:"fresh_staff_reauthentication_required"},{status:403});
  if (released === "CLINICAL_HOLD") {
    return NextResponse.json({ error: "specimen_clinical_quarantine_blocks_release" }, { status: 409 });
  }
  if (released === "RELEASE_STATE_CHANGED") {
    return NextResponse.json({ error: "result_already_released_or_state_changed" }, { status: 409 });
  }
  if (released === "QC_HOLD") {
    return NextResponse.json({
      error: "qc_release_blocked",
      qcStatus: committedQcGate?.status || "BLOCK",
      reasons: committedQcGate?.reasons || [{ code: "ANALYZER_UNAVAILABLE", componentId: null }],
    }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    resultId: released.updatedResult.id,
    resultStatus: released.updatedResult.status,
    reportId: released.reportId,
    reportVersionId: released.reportVersionId,
    reportVersion: released.reportVersion,
    reportStatus: released.reportStatus,
    integrationQueue: released.integrationQueue,
  });
}
