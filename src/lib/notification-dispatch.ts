import { prisma } from "@/lib/db";

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

function providerUrl(channel: "EMAIL"|"SMS"|"WHATSAPP") {
  if (channel === "EMAIL") return process.env.NOTIFICATION_EMAIL_WEBHOOK_URL || "";
  if (channel === "SMS") return process.env.NOTIFICATION_SMS_WEBHOOK_URL || "";
  return process.env.NOTIFICATION_WHATSAPP_WEBHOOK_URL || "";
}

export async function dispatchNotificationDelivery(deliveryId: string) {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { event: true },
  });
  if (!delivery) return { status: "missing" as const };
  if (["SENT","DELIVERED","SKIPPED"].includes(delivery.status)) return { status: "already_final" as const };
  if (delivery.attemptCount >= MAX_ATTEMPTS) return { status: "attempt_limit" as const };

  if (delivery.channel === "IN_APP") {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", deliveredAt: delivery.deliveredAt || new Date(), lastError: null },
    });
    return { status: "delivered" as const };
  }

  if (!delivery.recipientAddress) {
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "SKIPPED", lastError: "recipient_address_missing" },
    });
    return { status: "skipped" as const };
  }

  const url = providerUrl(delivery.channel);
  const attempt = delivery.attemptCount + 1;
  const now = new Date();
  if (!url) {
    const terminal = attempt >= MAX_ATTEMPTS;
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: terminal ? "FAILED" : "QUEUED",
        attemptCount: attempt,
        lastAttemptAt: now,
        nextAttemptAt: terminal ? null : new Date(now.getTime() + BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60_000),
        lastError: "provider_not_configured",
      },
    });
    return { status: "provider_not_configured" as const };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.NOTIFICATION_PROVIDER_TOKEN ? { Authorization: "Bearer " + process.env.NOTIFICATION_PROVIDER_TOKEN } : {}),
      },
      body: JSON.stringify({
        deliveryId: delivery.id,
        channel: delivery.channel,
        recipient: delivery.recipientAddress,
        subject: delivery.subject,
        body: delivery.body,
        locale: delivery.locale,
        eventType: delivery.event.eventType,
        entityType: delivery.event.entityType,
        entityId: delivery.event.entityId,
      }),
    });
    if (!response.ok) throw new Error("provider_http_" + response.status);
    const body = await response.json().catch(() => ({})) as { messageId?: unknown; delivered?: unknown };
    const delivered = body.delivered === true;
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: delivered ? "DELIVERED" : "SENT",
        attemptCount: attempt,
        lastAttemptAt: now,
        sentAt: now,
        deliveredAt: delivered ? now : null,
        nextAttemptAt: null,
        providerMessageId: typeof body.messageId === "string" ? body.messageId.slice(0,255) : null,
        lastError: null,
      },
    });
    return { status: delivered ? "delivered" as const : "sent" as const };
  } catch (error) {
    const terminal = attempt >= MAX_ATTEMPTS;
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        attemptCount: attempt,
        lastAttemptAt: now,
        nextAttemptAt: terminal ? null : new Date(now.getTime() + BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60_000),
        lastError: error instanceof Error ? error.message.slice(0,2000) : "provider_error",
      },
    });
    return { status: terminal ? "failed_terminal" as const : "failed_retryable" as const };
  }
}
