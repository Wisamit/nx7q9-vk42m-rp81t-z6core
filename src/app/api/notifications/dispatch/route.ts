import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dispatchPendingNotifications } from "@/lib/notifications";
import { processTatEscalations } from "@/lib/tat-escalation";

export async function POST(request: Request) {
  const session = await requirePermission("notifications.dispatch");
  const ctx = await requestContext();
  const body = await request.json().catch(() => ({})) as { limit?: unknown };
  const requestedLimit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : 50;
  const limit = Math.min(Math.max(requestedLimit, 1), 200);

  const tatEscalations = await processTatEscalations(prisma, session.user.organizationId, new Date(), limit);
  const results = await dispatchPendingNotifications(prisma, session.user.organizationId, limit);
  await prisma.auditEvent.create({
    data: {
      organizationId: session.user.organizationId,
      branchId: session.activeBranchId,
      actorUserId: session.user.id,
      action: "NOTIFICATION_DISPATCH_RUN",
      entityType: "NotificationDelivery",
      entityId: "batch",
      newValues: {
        requestedLimit: limit,
        tatEscalationsCreated: tatEscalations.length,
        processed: results.length,
        sent: results.filter(item => item.status === "SENT").length,
        failed: results.filter(item => item.status === "FAILED").length,
        deadLetter: results.filter(item => item.status === "DEAD_LETTER").length,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
  return NextResponse.json({ status: "ok", tatEscalations, results });
}
