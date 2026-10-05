import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const session = await requirePermission("reports.deliver");
  const ctx = await requestContext();
  const { versionId } = await params;
  const body = await request.json().catch(() => null) as {
    channel?: string;
    recipient?: string;
    status?: string;
    externalRef?: string;
    details?: unknown;
  } | null;

  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const channel = ["PRINT","DOWNLOAD","EMAIL","SMS","WHATSAPP","PORTAL","OTHER"].includes(body.channel || "") ? body.channel! : null;
  const status = ["RECORDED","QUEUED","SENT","DELIVERED","FAILED"].includes(body.status || "") ? body.status! : "RECORDED";
  if (!channel) return NextResponse.json({ error: "invalid_channel" }, { status: 400 });

  const version = await prisma.diagnosticReportVersion.findFirst({
    where: {
      id: versionId,
      report: { organizationId: session.user.organizationId },
    },
    include: { report: { include: { order: true } } },
  });
  if (!version) return NextResponse.json({ error: "report_version_not_found" }, { status: 404 });

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.reportDeliveryEvent.create({
      data: {
        reportVersionId: version.id,
        channel: channel as "PRINT" | "DOWNLOAD" | "EMAIL" | "SMS" | "WHATSAPP" | "PORTAL" | "OTHER",
        status: status as "RECORDED" | "QUEUED" | "SENT" | "DELIVERED" | "FAILED",
        recipient: text(body.recipient) || null,
        externalRef: text(body.externalRef) || null,
        details: body.details && typeof body.details === "object" ? body.details as object : undefined,
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
          status,
          recipient: text(body.recipient) || null,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", deliveryEventId: event.id }, { status: 201 });
}
