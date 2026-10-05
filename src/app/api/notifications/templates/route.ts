import { NotificationChannel } from "../../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("notifications.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 100).toUpperCase();
  const eventCode = text(body.eventCode, 120).toUpperCase();
  const channel = typeof body.channel === "string" && Object.values(NotificationChannel).includes(body.channel as NotificationChannel)
    ? body.channel as NotificationChannel
    : null;
  const bodyEn = text(body.bodyEn, 20000);
  if (!code || !eventCode || !channel || !bodyEn) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const created = await prisma.$transaction(async tx => {
    const template = await tx.notificationTemplate.create({
      data: {
        organizationId: session.user.organizationId,
        code,
        eventCode,
        channel,
        subjectEn: text(body.subjectEn, 255) || null,
        subjectAr: text(body.subjectAr, 255) || null,
        bodyEn,
        bodyAr: text(body.bodyAr, 20000) || null,
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "NOTIFICATION_TEMPLATE_CREATED",
        entityType: "NotificationTemplate",
        entityId: template.id,
        newValues: { code, eventCode, channel },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return template;
  });
  return NextResponse.json({ status: "ok", template: created }, { status: 201 });
}
