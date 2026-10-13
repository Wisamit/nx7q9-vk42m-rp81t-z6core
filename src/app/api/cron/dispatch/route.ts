import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { processTatEscalations } from "@/lib/tat-escalation";
import { dispatchWebhookDelivery } from "@/lib/webhook-delivery";
import { authorizeCronRequest, dueWebhookFilter } from "@/lib/scheduled-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Machine-to-machine only. No staff session, browser cookie, GET secret or arbitrary
 * organization selection. Every scheduled invocation must name an explicitly
 * allowlisted, active organization and present the dedicated host secret.
 *
 * Each invocation serves one job type, bounding web request duration.\n * Existing dispatchers own their delivery CAS/lease and retry policy.
 * The scheduler never touches actual lab results, reports, prices or inventory.
 */
export async function POST(request: Request) {
  const size = request.headers.get("content-length");
  if (size && (!/^\d{1,5}$/.test(size) || Number(size) > 2048)) {
    return json({ error: "invalid_scheduler_request" }, 413);
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return json({ error: "invalid_scheduler_request" }, 415);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 2048) return json({ error: "invalid_scheduler_request" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid_scheduler_request" }, 400); }
  const values = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const organizationId = values.organizationId;
  const operation = values.operation;
  if (operation !== "TAT" && operation !== "NOTIFICATIONS" && operation !== "WEBHOOKS") {
    return json({ error: "scheduler_operation_required" }, 400);
  }

  const authorized = authorizeCronRequest(request.headers.get("authorization"),
    organizationId, process.env);
  if (!authorized.ok) return json({ error: "scheduled_dispatch_not_authorized" }, 401);
  if ((operation === "TAT" && !authorized.plan.tat)
      || (operation === "NOTIFICATIONS" && !authorized.plan.notifications)
      || (operation === "WEBHOOKS" && !authorized.plan.webhooks)) {
    return json({ error: "scheduler_operation_disabled" }, 403);
  }

  const organization = await prisma.organization.findFirst({
    where: { id: authorized.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!organization) return json({ error: "organization_not_active" }, 404);

  const now = new Date();
  const failedSteps: string[] = [];
  let tatEscalations = 0;
  let notificationsAttempted = 0;
  let notificationsFailed = 0;
  let notificationsDeadLetter = 0;
  let webhookAttempted = 0;
  let webhookDelivered = 0;
  let webhookFailed = 0;

  // Each part is independent: failure of one queue must not prevent the others.
  if (operation === "TAT") {
    try {
      const escalations = await processTatEscalations(prisma, organization.id, now, 40);
      tatEscalations = escalations.length;
    } catch {
      failedSteps.push("tat");
    }
  }
  if (operation === "NOTIFICATIONS") {
    try {
      const sent = await dispatchPendingNotifications(prisma, organization.id, 8);
      notificationsAttempted = sent.length;
      notificationsFailed = sent.filter(item =>
        item.status === "FAILED" || item.status === "DEAD_LETTER").length;
      notificationsDeadLetter = sent.filter(item => item.status === "DEAD_LETTER").length;
    } catch {
      failedSteps.push("notifications");
    }
  }
  if (operation === "WEBHOOKS") {
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: dueWebhookFilter(organization.id, now),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 3,
        select: { id: true },
      });
      for (const delivery of deliveries) {
        try {
          const result = await dispatchWebhookDelivery(delivery.id);
          if (!result) continue; // Another worker owned the CAS claim.
          webhookAttempted++;
          if (result.status === "DELIVERED") webhookDelivered++;
          else if (result.status === "FAILED" || result.status === "DEAD_LETTER") webhookFailed++;
        } catch {
          webhookFailed++;
          failedSteps.push("webhooks");
        }
      }
    } catch {
      failedSteps.push("webhooks");
    }
  }
  // Never persist tokens, destinations, patient-identifiable payloads or provider errors.
  const outcome = {
    mode: "SCHEDULED", operation, startedAt: now.toISOString(),
    enabled: { tat: authorized.plan.tat,
      notifications: authorized.plan.notifications, webhooks: authorized.plan.webhooks },
    tatEscalations,
    notificationsAttempted, notificationsFailed, notificationsDeadLetter,
    webhookAttempted, webhookDelivered, webhookFailed,
    failedSteps: [...new Set(failedSteps)],
  };
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        branchId: null,
        actorUserId: null,
        action: "SCHEDULED_COMMUNICATION_DISPATCH_RUN",
        entityType: "ScheduledWorker",
        entityId: organization.id,
        newValues: outcome,
        reason: "Authenticated, allowlisted organization scheduler invocation",
      },
    });
  } catch {
    return json({ error: "scheduler_audit_failed" }, 503);
  }
  return json({ status: failedSteps.length ? "partial_failure" : "ok", ...outcome },
    failedSteps.length ? 503 : 200);
}
