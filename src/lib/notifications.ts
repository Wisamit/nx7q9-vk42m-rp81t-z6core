import { Prisma } from "../../generated/prisma/client";

type Tx = Prisma.TransactionClient;

type StaffNotificationInput = {
  organizationId: string;
  branchId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  permissionCode: string;
  payload: Record<string, unknown>;
  fallbackSubject: string;
  fallbackBody: string;
  createdByUserId?: string | null;
};

function scalar(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderNotificationTemplate(template: string, payload: Record<string, unknown>) {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key: string) => scalar(payload[key]));
}

async function activeTemplate(
  tx: Tx,
  input: { organizationId: string; branchId?: string | null; eventType: string; channel: "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP"; locale: string; now: Date },
) {
  const templates = await tx.notificationTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      channel: input.channel,
      locale: input.locale,
      status: "ACTIVE",
      effectiveFrom: { lte: input.now },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.now } }] },
        { OR: [{ branchId: input.branchId || undefined }, { branchId: null }] },
      ],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    take: 20,
  });
  return templates.find(item => input.branchId && item.branchId === input.branchId)
    || templates.find(item => item.branchId === null)
    || null;
}

export async function notifyStaffByPermission(tx: Tx, input: StaffNotificationInput) {
  const now = new Date();
  const users = await tx.user.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(input.branchId ? {
        branchScopes: { some: { branchId: input.branchId, branch: { status: "ACTIVE" } } },
      } : {}),
      roles: {
        some: {
          role: {
            status: "ACTIVE",
            permissions: { some: { permission: { code: input.permissionCode } } },
          },
        },
      },
    },
    select: { id: true, preferredLocale: true },
    take: 500,
  });

  const event = await tx.notificationEvent.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId || null,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      severity: input.severity || "INFO",
      payload: input.payload as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId || null,
      occurredAt: now,
    },
  });

  let deliveryCount = 0;
  for (const user of users) {
    const preference = await tx.notificationPreference.findUnique({
      where: {
        organizationId_recipientType_recipientId_eventType_channel: {
          organizationId: input.organizationId,
          recipientType: "USER",
          recipientId: user.id,
          eventType: input.eventType,
          channel: "IN_APP",
        },
      },
      select: { enabled: true },
    });
    if (preference?.enabled === false) continue;

    const locale = user.preferredLocale === "ar" ? "ar" : "en";
    const template = await activeTemplate(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      eventType: input.eventType,
      channel: "IN_APP",
      locale,
      now,
    });

    const subject = template?.subjectTemplate
      ? renderNotificationTemplate(template.subjectTemplate, input.payload)
      : input.fallbackSubject;
    const body = template
      ? renderNotificationTemplate(template.bodyTemplate, input.payload)
      : input.fallbackBody;

    await tx.notificationDelivery.create({
      data: {
        organizationId: input.organizationId,
        eventId: event.id,
        templateId: template?.id || null,
        recipientType: "USER",
        recipientId: user.id,
        recipientUserId: user.id,
        channel: "IN_APP",
        locale,
        subject,
        body,
        status: "DELIVERED",
        deliveredAt: now,
      },
    });
    deliveryCount++;
  }

  return { eventId: event.id, deliveryCount };
}

type PortalNotificationInput = {
  organizationId: string;
  branchId?: string | null;
  portalAccountId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  payload: Record<string, unknown>;
  fallbackSubject: string;
  fallbackBody: string;
  createdByUserId?: string | null;
};

export async function queuePortalNotification(tx: Tx, input: PortalNotificationInput) {
  const now = new Date();
  const account = await tx.portalAccount.findFirst({
    where: { id: input.portalAccountId, organizationId: input.organizationId, status: "ACTIVE" },
    select: { id: true, email: true, phone: true, preferredLocale: true },
  });
  if (!account) return { eventId: null, deliveryCount: 0 };

  const event = await tx.notificationEvent.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId || null,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      severity: input.severity || "INFO",
      payload: input.payload as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId || null,
      occurredAt: now,
    },
  });

  const candidates: Array<{ channel: "EMAIL" | "SMS" | "WHATSAPP"; address: string }> = [];
  if (account.email) candidates.push({ channel: "EMAIL", address: account.email });
  if (account.phone) {
    candidates.push({ channel: "SMS", address: account.phone });
    candidates.push({ channel: "WHATSAPP", address: account.phone });
  }

  const locale = account.preferredLocale === "ar" ? "ar" : "en";
  let deliveryCount = 0;
  for (const candidate of candidates) {
    const preference = await tx.notificationPreference.findUnique({
      where: {
        organizationId_recipientType_recipientId_eventType_channel: {
          organizationId: input.organizationId,
          recipientType: "PORTAL_ACCOUNT",
          recipientId: account.id,
          eventType: input.eventType,
          channel: candidate.channel,
        },
      },
      select: { enabled: true },
    });
    if (preference?.enabled === false) continue;

    const template = await activeTemplate(tx, {
      organizationId: input.organizationId,
      branchId: input.branchId,
      eventType: input.eventType,
      channel: candidate.channel,
      locale,
      now,
    });
    if (!template) continue;

    await tx.notificationDelivery.create({
      data: {
        organizationId: input.organizationId,
        eventId: event.id,
        templateId: template.id,
        recipientType: "PORTAL_ACCOUNT",
        recipientId: account.id,
        recipientAddress: candidate.address,
        channel: candidate.channel,
        locale,
        subject: template.subjectTemplate ? renderNotificationTemplate(template.subjectTemplate, input.payload) : input.fallbackSubject,
        body: renderNotificationTemplate(template.bodyTemplate, input.payload) || input.fallbackBody,
        status: "QUEUED",
        nextAttemptAt: now,
      },
    });
    deliveryCount++;
  }

  return { eventId: event.id, deliveryCount };
}
