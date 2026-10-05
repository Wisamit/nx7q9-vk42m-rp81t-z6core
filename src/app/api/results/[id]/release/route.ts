import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildDiagnosticReportSnapshot } from "@/lib/report-snapshot";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("results.release");
  const ctx = await requestContext();
  const { id } = await params;

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      values: true,
      criticalEvents: { include: { communications: true } },
      orderItem: { include: { order: true } },
    },
  });

  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (result.status !== "VERIFIED") {
    return NextResponse.json({ error: "result_not_releasable", status: result.status }, { status: 409 });
  }

  const criticalValues = result.values.filter((value) => value.isCritical);
  const criticalEvent = result.criticalEvents[0] || null;
  if (criticalValues.length > 0 && criticalEvent?.status !== "ACKNOWLEDGED") {
    return NextResponse.json({
      error: "critical_acknowledgement_required",
      criticalCount: criticalValues.length,
    }, { status: 409 });
  }

  const releasedAt = new Date();

  const released = await prisma.$transaction(async (tx) => {
    const updatedResult = await tx.laboratoryResult.update({
      where: { id: result.id },
      data: {
        status: "RELEASED",
        releasedByUserId: session.user.id,
        releasedAt,
      },
    });

    if (result.amendedFromId) {
      await tx.laboratoryResult.updateMany({
        where: { id: result.amendedFromId, status: "RELEASED" },
        data: { status: "AMENDED" },
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

    const previousVersion = await tx.diagnosticReportVersion.findFirst({
      where: { reportId: report.id },
      orderBy: { version: "desc" },
    });

    const snapshot = await buildDiagnosticReportSnapshot(tx, result.orderItem.orderId);
    const version = (previousVersion?.version || 0) + 1;
    const reportStatus = result.amendedFromId
      ? "AMENDED"
      : snapshot.allReleased ? "FINAL" : "PARTIAL";

    const reportVersion = await tx.diagnosticReportVersion.create({
      data: {
        reportId: report.id,
        version,
        status: reportStatus,
        branchId: result.orderItem.orderingBranchId,
        contentSnapshot: snapshot.contentSnapshot,
        resultVersionSnapshot: snapshot.resultVersionSnapshot,
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
          amendedFromId: result.amendedFromId,
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
    };
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    resultId: released.updatedResult.id,
    resultStatus: released.updatedResult.status,
    reportId: released.reportId,
    reportVersionId: released.reportVersionId,
    reportVersion: released.reportVersion,
    reportStatus: released.reportStatus,
  });
}
