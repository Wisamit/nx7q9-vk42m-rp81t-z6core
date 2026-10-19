import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

class ReportDeliveryStateChanged extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const session = await requirePermission("reports.deliver");
  const ctx = await requestContext();
  const { versionId } = await params;
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = rawBody as { channel?: unknown; status?: unknown; details?: unknown };
  // Staff can record only the browser's print and PDF preparation attempts
  // here. Provider/portal SENT and DELIVERED evidence must come from their
  // trusted dispatcher or authenticated portal session, never the browser.
  if (body.channel !== "PRINT" && body.channel !== "DOWNLOAD") {
    return NextResponse.json({ error: "trusted_delivery_channel_required" }, { status: 400 });
  }
  if (body.status !== "RECORDED") {
    return NextResponse.json({ error: "delivery_status_not_client_assignable" }, { status: 400 });
  }
  const channel = body.channel;
  let details: Prisma.InputJsonValue = { action: "BROWSER_PRINT_REQUESTED", verifiedPhysicalPrint: false };
  if (channel === "DOWNLOAD") {
    const metadata = body.details;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return NextResponse.json({ error: "invalid_pdf_metadata" }, { status: 400 });
    }
    const input = metadata as Record<string, unknown>;
    if (typeof input.fileName !== "string" || !/^[a-zA-Z0-9._-]{1,180}\.pdf$/.test(input.fileName)
      || input.mimeType !== "application/pdf"
      || typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(input.sha256)
      || typeof input.pageCount !== "number" || !Number.isInteger(input.pageCount)
      || input.pageCount < 1 || input.pageCount > 200
      || input.renderer !== "browser-dom-raster-v1") {
      return NextResponse.json({ error: "invalid_pdf_metadata" }, { status: 400 });
    }
    details = {
      action: "BROWSER_PDF_PREPARED",
      fileName: input.fileName,
      mimeType: "application/pdf",
      sha256: input.sha256.toLowerCase(),
      pageCount: input.pageCount,
      renderer: "browser-dom-raster-v1",
      verifiedRecipientDownload: false,
    };
  }

  const version = await prisma.diagnosticReportVersion.findFirst({
    where: {
      id: versionId,
      report: { organizationId: session.user.organizationId },
    },
    include: { report: { include: { order: true } } },
  });
  if (!version) return NextResponse.json({ error: "report_version_not_found" }, { status: 404 });
  if (!canAccessBranch(session, version.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (version.version !== version.report.currentVersion ||
      !["PARTIAL", "FINAL", "AMENDED"].includes(version.status)) {
    return NextResponse.json({ error: "report_version_not_current_or_retracted" }, { status: 409 });
  }

  const event = await prisma.$transaction(async (tx) => {
    // Report revisions and report deliveries serialize on the same parent.
    // A withdrawn or superseded report must not produce a new PRINT/PDF event.
    const currentReport = await tx.$queryRaw<Array<{ currentVersion: number }>>`
      SELECT current_version AS currentVersion FROM diagnostic_reports
      WHERE id = ${version.reportId} AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (currentReport.length !== 1 || currentReport[0].currentVersion !== version.version) {
      throw new ReportDeliveryStateChanged();
    }
    // Also lock the exact version row: a retraction that updates only its
    // status cannot race with this audit event even without a parent lock.
    const currentVersion = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM diagnostic_report_versions
      WHERE id = ${version.id} AND report_id = ${version.reportId}
      FOR UPDATE
    `;
    if (currentVersion.length !== 1 ||
        !["PARTIAL", "FINAL", "AMENDED"].includes(currentVersion[0].status)) {
      throw new ReportDeliveryStateChanged();
    }
    const created = await tx.reportDeliveryEvent.create({
      data: {
        reportVersionId: version.id,
        channel,
        status: "RECORDED",
        recipient: null,
        externalRef: null,
        details,
        performedByUserId: session.user.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: version.branchId,
        actorUserId: session.user.id,
        action: "REPORT_DELIVERY_RECORDED",
        entityType: "DiagnosticReportVersion",
        entityId: version.id,
        newValues: {
          reportId: version.reportId,
          reportVersion: version.version,
          channel,
          status: "RECORDED",
          evidenceType: channel === "PRINT" ? "PRINT_REQUESTED" : "PDF_PREPARED",
          actualPhysicalDeliveryConfirmed: false,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  }).catch(error => {
    if (error instanceof ReportDeliveryStateChanged) return null;
    throw error;
  });
  if (!event) {
    return NextResponse.json({ error: "report_version_not_current_or_retracted" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", deliveryEventId: event.id }, { status: 201 });
}
