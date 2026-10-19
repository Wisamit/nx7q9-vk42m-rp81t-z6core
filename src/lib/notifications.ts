import { randomUUID } from "node:crypto";
import { safeOutboundUrl } from "@/lib/webhook-delivery";
import { currentReportRecipientAuthorized } from "@/lib/report-outbound-authorization";
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
  reportDeliveryEventIdByChannel?: Partial<Record<NotificationChannel, string>>;
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
          reportDeliveryEventId: input.reportDeliveryEventIdByChannel?.[channel] || null,
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
          reportDeliveryEventId: input.reportDeliveryEventIdByChannel?.[channel] || null,
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
        reportDeliveryEventId: input.reportDeliveryEventIdByChannel?.[channel] || null,
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


const DISPATCH_LEASE_MS = 10 * 60_000;

/**
 * A late gateway response can only finalize the attempt that it owns.
 * A newer worker may have reclaimed an expired lease; neither status nor
 * report delivery history can be rewritten by the old response.
 */
async function finalizeNotificationClaim(
  db: PrismaClient,
  delivery: {
    id: string;
    status: NotificationDeliveryStatus;
    reportDeliveryEventId: string | null;
  },
  organizationId: string,
  token: string,
  attempt: number,
  data: Prisma.NotificationDeliveryUpdateManyMutationInput,
  reportData: { status: "FAILED" | "QUEUED" | "SENT" | "DELIVERED"; externalRef?: string | null } | null,
) {
  return db.$transaction(async tx => {
    const updated = await tx.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        notification: { organizationId },
        status: delivery.status,
        dispatchToken: token,
        attemptCount: attempt,
      },
      data: {
        ...data,
        dispatchToken: null,
        dispatchLeaseUntil: null,
      },
    });
    if (updated.count !== 1) return false;
    if (reportData && delivery.reportDeliveryEventId) {
      await tx.reportDeliveryEvent.update({
        where: { id: delivery.reportDeliveryEventId },
        data: reportData,
      });
    }
    return true;
  });
}

export async function dispatchPendingNotifications(db: PrismaClient, organizationId: string, limit = 50) {
  const now = new Date();
  const deliveries = await db.notificationDelivery.findMany({
    where: {
      notification: { organizationId },
      channel: { in: [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.WHATSAPP] },
      status: { in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      AND: [{ OR: [
        { dispatchLeaseUntil: null },
        { dispatchLeaseUntil: { lte: now } },
      ] }],
    },
    include: { notification: true, reportDeliveryEvent: true },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 200),
  });

  const results: Array<{ id: string; status: NotificationDeliveryStatus; error?: string }> = [];

  for (const delivery of deliveries) {
    // A crashed final retry is terminal, not eligible for an unbounded
    // sixth attempt after its lease expires.
    if (delivery.attemptCount >= delivery.maxAttempts) {
      const exhausted = await db.$transaction(async tx => {
        const closed = await tx.notificationDelivery.updateMany({
          where: {
            id: delivery.id,
            notification: { organizationId },
            status: delivery.status,
            attemptCount: delivery.attemptCount,
            dispatchToken: delivery.dispatchToken,
            dispatchLeaseUntil: delivery.dispatchLeaseUntil,
          },
          data: {
            status: NotificationDeliveryStatus.DEAD_LETTER,
            dispatchToken: null,
            dispatchLeaseUntil: null,
            nextAttemptAt: null,
            lastError: "notification_retry_budget_exhausted",
          },
        });
        if (closed.count !== 1) return false;
        if (delivery.reportDeliveryEventId) {
          await tx.reportDeliveryEvent.update({
            where: { id: delivery.reportDeliveryEventId },
            data: { status: "FAILED" },
          });
        }
        return true;
      });
      if (exhausted) results.push({
        id: delivery.id,
        status: NotificationDeliveryStatus.DEAD_LETTER,
        error: "notification_retry_budget_exhausted",
      });
      continue;
    }

    const attempt = delivery.attemptCount + 1;
    const token = randomUUID();
    const claimedAt = new Date();
    const claim = await db.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        notification: { organizationId },
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        maxAttempts: delivery.maxAttempts,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: claimedAt } }],
        AND: [{ OR: [
          { dispatchLeaseUntil: null },
          { dispatchLeaseUntil: { lte: claimedAt } },
        ] }],
      },
      data: {
        attemptCount: { increment: 1 },
        dispatchToken: token,
        dispatchLeaseUntil: new Date(claimedAt.getTime() + DISPATCH_LEASE_MS),
      },
    });
    if (claim.count !== 1) continue;

    // A queued report link must be checked again when the provider is about
    // to send it. Clinical amendments may have superseded the version after
    // a legitimate queue request. Never dispatch a withdrawn/outdated link.
    if (delivery.reportDeliveryEventId) {
      const version = await db.diagnosticReportVersion.findFirst({
        where: {
          id: delivery.reportDeliveryEvent!.reportVersionId,
          report: { organizationId },
        },
        include: { report: { select: { currentVersion: true,
          order: { select: { patientId: true } },
        } } },
      });
      if (!version || version.status === "RETRACTED" || version.version !== version.report.currentVersion) {
        const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
          status: NotificationDeliveryStatus.SKIPPED,
          attemptCount: attempt,
          lastError: "report_version_superseded_or_retracted",
          nextAttemptAt: null,
        }, { status: "FAILED" });
        if (settled) results.push({
          id: delivery.id, status: NotificationDeliveryStatus.SKIPPED,
          error: "report_version_superseded_or_retracted",
        });
        continue;
      }

      // Revoked portal verification, changed destination, disabled account or
      // withdrawn corporate patient access must stop a queued report link
      // before contacting any external provider. This is a fresh send-time
      // authorization check, independent of the enqueue-time transaction.
      const recipientType = delivery.notification.recipientType;
      const referenceId = delivery.notification.recipientReferenceId;
      const supported = recipientType === NotificationRecipientType.PATIENT ||
        recipientType === NotificationRecipientType.REFERRER ||
        recipientType === NotificationRecipientType.CLIENT;
      const eligible = supported && referenceId && delivery.destination
        ? await currentReportRecipientAuthorized(db, {
            organizationId,
            recipientType,
            recipientId: referenceId,
            patientId: version!.report.order.patientId,
            channel: delivery.channel as "EMAIL" | "SMS" | "WHATSAPP",
            destination: delivery.destination,
          })
        : false;
      if (!eligible) {
        const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
          status: NotificationDeliveryStatus.SKIPPED,
          attemptCount: attempt,
          lastError: "report_recipient_authorization_revoked_or_changed",
          nextAttemptAt: null,
        }, { status: "FAILED" });
        if (settled) results.push({
          id: delivery.id, status: NotificationDeliveryStatus.SKIPPED,
          error: "report_recipient_authorization_revoked_or_changed",
        });
        continue;
      }
    }

    const config = gatewayConfig(delivery.channel);

    if (!delivery.destination) {
      const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
        status: NotificationDeliveryStatus.SKIPPED,
        attemptCount: attempt,
        lastError: "destination_missing",
        nextAttemptAt: null,
      }, { status: "FAILED" });
      if (settled) results.push({
        id: delivery.id, status: NotificationDeliveryStatus.SKIPPED, error: "destination_missing",
      });
      continue;
    }

    if (!config) {
      const dead = attempt >= delivery.maxAttempts;
      const status = dead ? NotificationDeliveryStatus.DEAD_LETTER : NotificationDeliveryStatus.FAILED;
      const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
        status,
        attemptCount: attempt,
        lastError: "notification_gateway_not_configured",
        nextAttemptAt: dead ? null : retryAt(attempt),
      }, { status: dead ? "FAILED" : "QUEUED" });
      if (settled) results.push({
        id: delivery.id, status, error: "notification_gateway_not_configured",
      });
      continue;
    }

    // All attempts for one delivery use a stable idempotency key. The gateway
    // MUST honor that key for provider-side deduplication after a crash.
    const idempotencyKey = "familylab-notification:" + delivery.id;
    try {
      const response = await fetch(safeOutboundUrl(config.url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...(config.token ? { Authorization: "Bearer " + config.token } : {}),
        },
        body: JSON.stringify({
          channel: delivery.channel,
          destination: delivery.destination,
          subject: delivery.notification.title,
          body: delivery.notification.body,
          eventCode: delivery.notification.eventCode,
          notificationId: delivery.notification.id,
          deliveryId: delivery.id,
          idempotencyKey,
          metadata: delivery.notification.metadata,
        }),
      });
      if (!response.ok) throw new Error("gateway_http_" + response.status);
      const payload = await response.json().catch(() => ({})) as {
        messageId?: unknown; status?: unknown; delivered?: unknown;
      };
      const providerMessageId = typeof payload.messageId === "string"
        ? payload.messageId.slice(0, 255) : null;
      const providerDelivered = payload.delivered === true ||
        (typeof payload.status === "string" && payload.status.toUpperCase() === "DELIVERED");

      const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
        status: providerDelivered && providerMessageId ? NotificationDeliveryStatus.DELIVERED : NotificationDeliveryStatus.SENT,
        attemptCount: attempt,
        sentAt: new Date(),
        deliveredAt: providerDelivered && providerMessageId ? new Date() : null,
        provider: config.provider,
        providerMessageId,
        lastError: null,
        nextAttemptAt: null,
      }, { status: providerDelivered && providerMessageId ? "DELIVERED" : "SENT", externalRef: providerMessageId });
      if (settled) results.push({ id: delivery.id, status: providerDelivered && providerMessageId ? NotificationDeliveryStatus.DELIVERED : NotificationDeliveryStatus.SENT });
    } catch (error) {
      const dead = attempt >= delivery.maxAttempts;
      const status = dead ? NotificationDeliveryStatus.DEAD_LETTER : NotificationDeliveryStatus.FAILED;
      const message = error instanceof Error ? error.message.slice(0, 1000) : "notification_dispatch_failed";
      const settled = await finalizeNotificationClaim(db, delivery, organizationId, token, attempt, {
        status,
        attemptCount: attempt,
        lastError: message,
        nextAttemptAt: dead ? null : retryAt(attempt),
      }, { status: dead ? "FAILED" : "QUEUED" });
      if (settled) results.push({ id: delivery.id, status, error: message });
    }
  }
  return results;
}


export async function notifyUsersWithPermission(db: DbClient, input: {
  organizationId: string;
  branchId: string;
  permissionCode: string;
  eventCode: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const users = await db.user.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      branchScopes: { some: { branchId: input.branchId } },
      roles: {
        some: {
          role: {
            permissions: {
              some: { permission: { code: input.permissionCode } },
            },
          },
        },
      },
    },
    select: { id: true },
  });

  for (const user of users) {
    await enqueueNotification(db, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      eventCode: input.eventCode,
      recipientType: NotificationRecipientType.USER,
      recipientUserId: user.id,
      title: input.title,
      body: input.body,
      severity: input.severity,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      channels: [NotificationChannel.IN_APP],
    });
  }

  return users.length;
}
