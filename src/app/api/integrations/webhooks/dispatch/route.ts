import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dispatchWebhookDelivery } from "@/lib/webhook-delivery";

export async function POST(request: Request) {
  const session = await requirePermission("integrations.replay");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as { deliveryId?: unknown } | null;
  const deliveryId = typeof body?.deliveryId === "string" ? body.deliveryId.trim() : "";

  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: { in: ["QUEUED","FAILED"] },
      ...(deliveryId ? { id: deliveryId } : {}),
    },
    include: { subscription: { include: { endpoint: true } } },
    orderBy: { createdAt: "asc" },
    take: deliveryId ? 1 : 20,
  });

  const due = deliveries.filter(item =>
    (!item.nextAttemptAt || item.nextAttemptAt <= new Date()) &&
    (!item.subscription.endpoint.branchId || canAccessBranch(session, item.subscription.endpoint.branchId))
  );

  const results = [];
  for (const item of due) {
    const updated = await dispatchWebhookDelivery(item.id);
    results.push({ id: item.id, status: updated.status, attemptCount: updated.attemptCount });
  }

  await prisma.auditEvent.create({
    data: {
      organizationId: session.user.organizationId,
      branchId: session.activeBranchId,
      actorUserId: session.user.id,
      action: "WEBHOOK_DISPATCH_RUN",
      entityType: "WebhookDelivery",
      entityId: deliveryId || "BATCH",
      newValues: { requested: deliveries.length, attempted: due.length, results },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return NextResponse.json({ status: "ok", attempted: due.length, results });
}
