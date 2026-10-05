import { NotificationChannel } from "../../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const allowedChannels = new Set(Object.values(NotificationChannel));

export async function POST(request: Request) {
  const session = await requirePermission("notifications.view");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    eventCode?: unknown;
    channel?: unknown;
    enabled?: unknown;
  } | null;

  const eventCode = typeof body?.eventCode === "string" ? body.eventCode.trim().slice(0, 120) : "";
  const channel = typeof body?.channel === "string" && allowedChannels.has(body.channel as NotificationChannel)
    ? body.channel as NotificationChannel
    : null;
  const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;

  if (!eventCode || !channel || enabled === null) {
    return NextResponse.json({ error: "invalid_preference" }, { status: 400 });
  }

  const preference = await prisma.notificationPreference.upsert({
    where: {
      userId_eventCode_channel: {
        userId: session.user.id,
        eventCode,
        channel,
      },
    },
    update: { enabled },
    create: {
      organizationId: session.user.organizationId,
      userId: session.user.id,
      eventCode,
      channel,
      enabled,
    },
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: session.user.organizationId,
      branchId: session.activeBranchId,
      actorUserId: session.user.id,
      action: "NOTIFICATION_PREFERENCE_CHANGED",
      entityType: "NotificationPreference",
      entityId: preference.id,
      newValues: { eventCode, channel, enabled },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return NextResponse.json({ status: "ok", preference });
}
