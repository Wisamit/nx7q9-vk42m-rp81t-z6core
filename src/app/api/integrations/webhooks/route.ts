import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SUPPORTED_EVENTS = new Set(["diagnostic_report.released","diagnostic_report.amended"]);

export async function POST(request: Request) {
  const session = await requirePermission("integrations.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  const endpointId = typeof body?.endpointId === "string" ? body.endpointId.trim() : "";
  const eventType = typeof body?.eventType === "string" ? body.eventType.trim() : "";

  if (!endpointId || !SUPPORTED_EVENTS.has(eventType)) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const endpoint = await prisma.integrationEndpoint.findFirst({
    where: {
      id: endpointId,
      organizationId: session.user.organizationId,
      status: "ACTIVE",
      endpointType: { in: ["WEBHOOK","REST"] },
      direction: { in: ["OUTBOUND","BIDIRECTIONAL"] },
    },
  });
  if (!endpoint) return NextResponse.json({ error: "outbound_endpoint_not_found" }, { status: 404 });
  if (!endpoint.baseUrl) return NextResponse.json({ error: "endpoint_url_required" }, { status: 409 });
  if (endpoint.branchId && !canAccessBranch(session, endpoint.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const subscription = await prisma.$transaction(async tx => {
    const created = await tx.webhookSubscription.upsert({
      where: { endpointId_eventType: { endpointId, eventType } },
      update: { status: "ACTIVE" },
      create: {
        organizationId: session.user.organizationId,
        endpointId,
        eventType,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: endpoint.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "WEBHOOK_SUBSCRIPTION_ENABLED",
        entityType: "WebhookSubscription",
        entityId: created.id,
        newValues: { endpointId, eventType },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", subscription }, { status: 201 });
}
