import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationRecipientType,
  NotificationSeverity,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type EnqueueInput = {
  organizationId: string;
  branchId?: string | null;
  eventCode: string;
  recipientType?: NotificationRecipientType;
  recipientUserId?: string | null;
  recipientReferenceId?: string | null;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  channels?: NotificationChannel[];
  destinations?: Partial<Record<NotificationChannel, string>>;
};

export async function enqueueNotification(db: DbClient, input: EnqueueInput) {
  const channels = input.channels?.length ? [...new Set(input.channels)] : [NotificationChannel.IN_APP];
  const recipientUser = input.recipientUserId
    ? await db.user.findFirst({
        where: { id: input.recipientUserId, organizationId: input.organizationId, status: "ACTIVE" },
        select: { id: true, email: true },
      })
    : null;

  const preferences = recipientUser
    ? await db.notificationPreference.findMany({
        where: {
          userId: recipientUser.id,
          eventCode: input.eventCode,
          channel: { in: channels },
        },
        select: { channel: true, enabled: true },
      })
    : [];

  const preferenceMap = new Map(preferences.map(item => [item.channel, item.enabled]));

  const notification = await db.notification.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      eventCode: input.eventCode,
      recipientType: input.recipientType ?? NotificationRecipientType.USER,
      recipientUserId: recipientUser?.id ?? null,
      recipientReferenceId: input.recipientReferenceId ?? null,
      title: input.title.slice(0, 255),
      body: input.body,
      severity: input.severity ?? NotificationSeverity.INFO,
      entityType: input.entityType?.slice(0, 100) ?? null,
      entityId: input.entityId?.slice(0, 100) ?? null,
      metadata: input.metadata,
    },
  });

  for (const channel of channels) {
    if (preferenceMap.get(channel) === false) {
      await db.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel,
          status: NotificationDeliveryStatus.SKIPPED,
          lastError: "disabled_by_recipient_preference",
        },
      });
      continue;
    }

    if (channel === NotificationChannel.IN_APP) {
      await db.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel,
          status: NotificationDeliveryStatus.SENT,
          sentAt: new Date(),
          provider: "internal",
        },
      });
      continue;
    }

    const destination = input.destinations?.[channel]
      || (channel === NotificationChannel.EMAIL ? recipientUser?.email || undefined : undefined);

    await db.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel,
        destination: destination ?? null,
        status: destination ? NotificationDeliveryStatus.PENDING : NotificationDeliveryStatus.SKIPPED,
        lastError: destination ? null : "destination_missing",
        nextAttemptAt: destination ? new Date() : null,
      },
    });
  }

  return notification;
}

function gatewayConfig(channel: NotificationChannel) {
  const prefix = channel === NotificationChannel.EMAIL
    ? "EMAIL"
    : channel === NotificationChannel.SMS
      ? "SMS"
      : channel === NotificationChannel.WHATSAPP
        ? "WHATSAPP"
        : null;
  if (!prefix) return null;

  const url = process.env[`NOTIFICATION_${prefix}_GATEWAY_URL`]?.trim();
  if (!url) return null;

  return {
    url,
    provider: process.env[`NOTIFICATION_${prefix}_PROVIDER`]?.trim() || "gateway",
    token: process.env.NOTIFICATION_GATEWAY_TOKEN?.trim() || "",
  };
}

function retryAt(attempt: number) {
  const seconds = Math.min(3600, Math.max(60, 60 * Math.pow(2, Math.max(0, attempt - 1))));
  return new Date(Date.now() + seconds * 1000);
}

export async function dispatchPendingNotifications(db: DbClient, limit = 50) {
  const now = new Date();
  const deliveries = await db.notificationDelivery.findMany({
    where: {
      channel: { in: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WHATSAPP] },
      status: { in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { notification: true },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 200),
  });

  const results: Array<{ id: string; status: NotificationDeliveryStatus; error?: string }> = [];

  for (const delivery of deliveries) {
    const attempt = delivery.attemptCount + 1;
    const config = gatewayConfig(delivery.channel);

    if (!delivery.destination) {
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SKIPPED,
          attemptCount: attempt,
          lastError: "destination_missing",
          nextAttemptAt: null,
        },
      });
      results.push({ id: delivery.id, status: NotificationDeliveryStatus.SKIPPED, error: "destination_missing" });
      continue;
    }

    if (!config) {
      const dead = attempt >= delivery.maxAttempts;
      const status = dead ? NotificationDeliveryStatus.DEAD_LETTER : NotificationDeliveryStatus.FAILED;
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          attemptCount: attempt,
          lastError: "notification_gateway_not_configured",
          nextAttemptAt: dead ? null : retryAt(attempt),
        },
      });
      results.push({ id: delivery.id, status, error: "notification_gateway_not_configured" });
      continue;
    }

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          channel: delivery.channel,
          destination: delivery.destination,
          subject: delivery.notification.title,
          body: delivery.notification.body,
          eventCode: delivery.notification.eventCode,
          notificationId: delivery.notification.id,
          metadata: delivery.notification.metadata,
        }),
      });

      if (!response.ok) {
        throw new Error(`gateway_http_${response.status}`);
      }

      const payload = await response.json().catch(() => ({})) as { messageId?: unknown };
      const providerMessageId = typeof payload.messageId === "string" ? payload.messageId.slice(0, 255) : null;

      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          attemptCount: attempt,
          sentAt: new Date(),
          provider: config.provider,
          providerMessageId,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      results.push({ id: delivery.id, status: NotificationDeliveryStatus.SENT });
    } catch (error) {
      const dead = attempt >= delivery.maxAttempts;
      const status = dead ? NotificationDeliveryStatus.DEAD_LETTER : NotificationDeliveryStatus.FAILED;
      const message = error instanceof Error ? error.message.slice(0, 1000) : "notification_dispatch_failed";
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          attemptCount: attempt,
          lastError: message,
          nextAttemptAt: dead ? null : retryAt(attempt),
        },
      });
      results.push({ id: delivery.id, status, error: message });
    }
  }

  return results;
}
