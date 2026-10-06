import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const session = await requirePermission("validation_holds.review");
  const ctx = await requestContext();
  const { id, eventId } = await params;
  const body = await request.json().catch(() => null) as { action?: string; note?: string } | null;

  if (body?.action !== "RESOLVE") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const note = text(body.note);
  if (!note) return NextResponse.json({ error: "review_note_required" }, { status: 400 });

  const event = await prisma.validationHoldEvent.findFirst({
    where: {
      id: eventId,
      resultId: id,
      result: { organizationId: session.user.organizationId },
    },
    include: {
      result: { include: { orderItem: { include: { test: { select: { departmentId: true } } } } } },
      rule: true,
    },
  });

  if (!event) return NextResponse.json({ error: "validation_hold_event_not_found" }, { status: 404 });
  if (!canAccessBranch(session, event.result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, event.result.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (event.status !== "ACTIVE") {
    return NextResponse.json({ error: "validation_hold_not_active", status: event.status }, { status: 409 });
  }

  const reviewedAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.validationHoldEvent.update({
      where: { id: event.id },
      data: {
        status: "RESOLVED",
        reviewedByUserId: session.user.id,
        reviewedAt,
        reviewNote: note,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: event.result.performingBranchId,
        actorUserId: session.user.id,
        action: "VALIDATION_HOLD_RESOLVED",
        entityType: "ValidationHoldEvent",
        entityId: event.id,
        oldValues: { status: event.status, severity: event.severitySnapshot },
        newValues: { status: "RESOLVED", resultId: event.resultId, ruleId: event.ruleId, reviewedAt },
        reason: note,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok", holdStatus: "RESOLVED" });
}
