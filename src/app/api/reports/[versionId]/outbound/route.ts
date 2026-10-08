import { NextResponse } from "next/server";
import {
  NotificationChannel,
  NotificationRecipientType,
  Prisma,
} from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canonicalReportOrigin } from "@/lib/report-origin";
import { enqueueNotification } from "@/lib/notifications";
import {
  defaultReportReadyMessage,
  maskedDestination,
  renderReportTemplate,
  resolveVerifiedPortalDestination,
  type ReportMessageContext,
  type ReportOutboundChannel,
  type ReportOutboundRecipientType,
} from "@/lib/report-outbound";

class OutboundReportVersionChanged extends Error {}

function recipientTypeEnum(value: ReportOutboundRecipientType) {
  if (value === "PATIENT") return NotificationRecipientType.PATIENT;
  if (value === "REFERRER") return NotificationRecipientType.REFERRER;
  return NotificationRecipientType.CLIENT;
}

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const session = await requirePermission("reports.deliver");
  const ctx = await requestContext();
  const { versionId } = await params;
  const body = await request.json().catch(() => null) as {
    channel?: string;
    recipientType?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const channel = ["EMAIL","SMS","WHATSAPP"].includes(body.channel || "")
    ? body.channel as ReportOutboundChannel
    : null;
  const recipientType = ["PATIENT","REFERRER","CLIENT"].includes(body.recipientType || "")
    ? body.recipientType as ReportOutboundRecipientType
    : null;
  if (!channel || !recipientType) {
    return NextResponse.json({ error: "invalid_delivery_target" }, { status: 400 });
  }

  const version = await prisma.diagnosticReportVersion.findFirst({
    where: {
      id: versionId,
      report: { organizationId: session.user.organizationId },
    },
    include: {
      report: {
        include: {
          order: {
            include: {
              patient: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
              referrer: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
              client: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
            },
          },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, status: true },
          },
        },
      },
    },
  });
  if (!version) return NextResponse.json({ error: "report_version_not_found" }, { status: 404 });
  if (!canAccessBranch(session, version.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (version.status === "RETRACTED") {
    return NextResponse.json({ error: "retracted_report_cannot_be_delivered" }, { status: 409 });
  }
  if (version.report.versions[0]?.id !== version.id) {
    return NextResponse.json({ error: "superseded_report_cannot_be_delivered" }, { status: 409 });
  }

  const order = version.report.order;
  const selected = recipientType === "PATIENT"
    ? {
        id: order.patient.id,
        nameEn: order.patient.fullNameEn,
        nameAr: order.patient.fullNameAr,
        account: order.patient.portalAccount,
      }
    : recipientType === "REFERRER"
      ? order.referrer ? {
          id: order.referrer.id,
          nameEn: order.referrer.nameEn,
          nameAr: order.referrer.nameAr,
          account: order.referrer.portalAccount,
        } : null
      : order.client ? {
          id: order.client.id,
          nameEn: order.client.nameEn,
          nameAr: order.client.nameAr,
          account: order.client.portalAccount,
        } : null;

  if (!selected) {
    return NextResponse.json({ error: "recipient_not_associated_with_order" }, { status: 409 });
  }

  const expectedPortalType = recipientType === "PATIENT" ? "PATIENT" : recipientType === "REFERRER" ? "DOCTOR" : "CORPORATE";
  if (selected.account && selected.account.type !== expectedPortalType) {
    return NextResponse.json({ error: "portal_account_type_mismatch" }, { status: 409 });
  }

  if (recipientType === "CLIENT") {
    const corporateAccess = await prisma.corporatePortalPatientAccess.findFirst({
      where: {
        clientId: selected.id,
        patientId: order.patientId,
        canViewReports: true,
        status: "ACTIVE",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { id: true },
    });
    if (!corporateAccess) {
      return NextResponse.json({ error: "corporate_report_access_required" }, { status: 403 });
    }
  }

  const destination = resolveVerifiedPortalDestination(selected.account, channel);
  if (!destination.ok) {
    return NextResponse.json({ error: destination.error }, { status: 409 });
  }

  const baseUrl = canonicalReportOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NODE_ENV === "production",
  );
  if (!baseUrl) {
    return NextResponse.json({ error: "public_app_url_required" }, { status: 503 });
  }

  const portalUrl = `${baseUrl}/portal/reports/${version.id}`;
  const patientName = destination.locale === "ar"
    ? order.patient.fullNameAr || order.patient.fullNameEn
    : order.patient.fullNameEn;
  const recipientName = destination.locale === "ar"
    ? selected.nameAr || selected.nameEn
    : selected.nameEn;
  const messageContext: ReportMessageContext = {
    recipientName,
    patientName,
    accessionNumber: order.accessionNumber,
    reportVersion: version.version,
    reportStatus: version.status,
    portalUrl,
  };

  const notificationChannel = NotificationChannel[channel];
  const template = await prisma.notificationTemplate.findFirst({
    where: {
      organizationId: session.user.organizationId,
      eventCode: "REPORT_RELEASED",
      channel: notificationChannel,
      enabled: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const fallback = defaultReportReadyMessage(destination.locale, recipientType, messageContext);
  const titleTemplate = destination.locale === "ar"
    ? template?.subjectAr || template?.subjectEn
    : template?.subjectEn || template?.subjectAr;
  const bodyTemplate = destination.locale === "ar"
    ? template?.bodyAr || template?.bodyEn
    : template?.bodyEn || template?.bodyAr;
  const title = renderReportTemplate(titleTemplate || fallback.title, messageContext).slice(0, 255);
  const messageBody = renderReportTemplate(bodyTemplate || fallback.body, messageContext);

  const queued = await prisma.$transaction(async tx => {
    // The report parent is locked by the clinical release workflow before
    // allocating a new version. Lock it here too so a concurrent amendment
    // cannot supersede the report between preflight and notification queue.
    const lockedReport = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM diagnostic_reports
      WHERE id = ${version.reportId} AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (lockedReport.length !== 1) throw new OutboundReportVersionChanged();
    const current = await tx.diagnosticReportVersion.findFirst({
      where: { reportId: version.reportId },
      orderBy: { version: "desc" },
      select: { id: true, status: true },
    });
    if (!current || current.id !== version.id || current.status === "RETRACTED") {
      throw new OutboundReportVersionChanged();
    }
    const reportDelivery = await tx.reportDeliveryEvent.create({
      data: {
        reportVersionId: version.id,
        channel,
        status: "QUEUED",
        recipient: destination.destination,
        performedByUserId: session.user.id,
        details: {
          recipientType,
          securePortal: true,
          destinationMasked: maskedDestination(channel, destination.destination),
          templateId: template?.id || null,
          eventCode: "REPORT_RELEASED",
        },
      },
    });

    const notification = await enqueueNotification(tx, {
      organizationId: session.user.organizationId,
      branchId: version.branchId,
      eventCode: "REPORT_RELEASED",
      recipientType: recipientTypeEnum(recipientType),
      recipientReferenceId: selected.id,
      title,
      body: messageBody,
      entityType: "DiagnosticReportVersion",
      entityId: version.id,
      metadata: {
        reportVersionId: version.id,
        reportId: version.reportId,
        reportVersion: version.version,
        reportStatus: version.status,
        accessionNumber: order.accessionNumber,
        securePortal: true,
        portalPath: `/portal/reports/${version.id}`,
        recipientType,
      } satisfies Prisma.InputJsonObject,
      channels: [notificationChannel],
      destinations: { [notificationChannel]: destination.destination },
      reportDeliveryEventIdByChannel: { [notificationChannel]: reportDelivery.id },
    });

    await tx.reportDeliveryEvent.update({
      where: { id: reportDelivery.id },
      data: {
        details: {
          recipientType,
          securePortal: true,
          destinationMasked: maskedDestination(channel, destination.destination),
          templateId: template?.id || null,
          eventCode: "REPORT_RELEASED",
          notificationId: notification.id,
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: version.branchId,
        actorUserId: session.user.id,
        action: "REPORT_OUTBOUND_QUEUED",
        entityType: "DiagnosticReportVersion",
        entityId: version.id,
        newValues: {
          reportVersion: version.version,
          channel,
          recipientType,
          destinationMasked: maskedDestination(channel, destination.destination),
          reportDeliveryEventId: reportDelivery.id,
          notificationId: notification.id,
          templateId: template?.id || null,
          securePortal: true,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { reportDeliveryId: reportDelivery.id, notificationId: notification.id };
  }).catch(error => {
    if (error instanceof OutboundReportVersionChanged) return null;
    throw error;
  });
  if (!queued) {
    return NextResponse.json({ error: "report_version_changed_retry" }, { status: 409 });
  }

  return NextResponse.json({
    status: "queued",
    channel,
    recipientType,
    destination: maskedDestination(channel, destination.destination),
    ...queued,
  }, { status: 201 });
}
