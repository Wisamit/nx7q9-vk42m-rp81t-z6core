import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const session = await requirePermission("reflex.review");
  const ctx = await requestContext();
  const { id, eventId } = await params;
  const body = await request.json().catch(() => null) as { action?: string; note?: string } | null;

  const action = body?.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : body?.action === "DISMISS" ? "DISMISSED" : null;
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const event = await prisma.reflexRuleEvent.findFirst({
    where: { id: eventId, resultId: id, result: { organizationId: session.user.organizationId } },
    include: {
      result: true,
      rule: { include: { targetTest: true } },
    },
  });
  if (!event) return NextResponse.json({ error: "reflex_event_not_found" }, { status: 404 });
  if (!canAccessBranch(session, event.result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (event.status !== "PENDING") {
    return NextResponse.json({ error: "reflex_event_not_pending", status: event.status }, { status: 409 });
  }

  const reviewedAt = new Date();
  const note = text(body?.note);

  await prisma.$transaction(async tx => {
    await tx.reflexRuleEvent.update({
      where: { id: event.id },
      data: {
        status: action,
        reviewedByUserId: session.user.id,
        reviewedAt,
        reviewNote: note || null,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: event.result.performingBranchId,
        actorUserId: session.user.id,
        action: action === "ACKNOWLEDGED" ? "REFLEX_RECOMMENDATION_ACKNOWLEDGED" : "REFLEX_RECOMMENDATION_DISMISSED",
        entityType: "ReflexRuleEvent",
        entityId: event.id,
        oldValues: { status: event.status },
        newValues: {
          status: action,
          resultId: event.resultId,
          targetTestId: event.rule.targetTestId,
          targetTestCode: event.rule.targetTest.code,
          reviewedAt,
        },
        reason: note || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok", reflexStatus: action });
}
