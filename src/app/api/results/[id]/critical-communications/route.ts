import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { claimCriticalCommunication } from "@/lib/critical-communication-claim";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("critical.communicate");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    method?: string;
    outcome?: string;
    recipientName?: string;
    recipientRole?: string;
    recipientContact?: string;
    acknowledgementConfirmed?: boolean;
    readBackConfirmed?: boolean;
    notes?: string;
  } | null;

  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const method = ["PHONE","VERBAL","EMAIL","SMS","WHATSAPP","OTHER"].includes(body.method || "") ? body.method! : null;
  const outcome = ["ACKNOWLEDGED","NO_ANSWER","LEFT_MESSAGE","FAILED","ESCALATED"].includes(body.outcome || "") ? body.outcome! : null;
  const recipientName = text(body.recipientName, 200);
  const recipientRole = text(body.recipientRole, 150);
  const recipientContact = text(body.recipientContact, 200);
  const notes = text(body.notes, 5000);
  const acknowledgementConfirmed = body.acknowledgementConfirmed === true;
  const readBackConfirmed = body.readBackConfirmed === true;

  if (!method || !outcome || !recipientName) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (outcome === "ACKNOWLEDGED" && !acknowledgementConfirmed) {
    return NextResponse.json({ error: "acknowledgement_confirmation_required" }, { status: 400 });
  }

  const result = await prisma.laboratoryResult.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { criticalEvents: true, orderItem: { include: { test: { select: { departmentId: true } } } } },
  });
  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, result.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  const eligibleForCriticalCommunication = ["VERIFIED","RELEASED"].includes(result.status)
    || (result.status === "ENTERED" && result.validationStage === "MEDICAL_VALIDATION");
  if (!eligibleForCriticalCommunication) {
    return NextResponse.json({
      error: "result_not_eligible_for_critical_communication",
      status: result.status,
      validationStage: result.validationStage,
    }, { status: 409 });
  }

  const event = result.criticalEvents[0];
  if (!event) return NextResponse.json({ error: "critical_event_not_found" }, { status: 404 });
  if (event.status !== "OPEN") {
    return NextResponse.json({ error: "critical_event_not_open_reload" }, { status: 409 });
  }
  if (outcome === "ACKNOWLEDGED" && event.requireReadBackSnapshot && !readBackConfirmed) {
    return NextResponse.json({ error: "read_back_confirmation_required" }, { status: 400 });
  }
  if (outcome === "ESCALATED" && event.maxEscalationLevelSnapshot !== null && event.escalationLevel >= event.maxEscalationLevelSnapshot) {
    return NextResponse.json({ error: "critical_escalation_limit_reached", escalationLevel: event.escalationLevel }, { status: 409 });
  }

  const communicatedAt = new Date();
  const acknowledged = outcome === "ACKNOWLEDGED" && acknowledgementConfirmed;
  const escalated = outcome === "ESCALATED";
  const nextEscalationLevel = escalated ? event.escalationLevel + 1 : event.escalationLevel;
  const nextEscalationDueAt = escalated && event.escalationIntervalMinutesSnapshot
    ? new Date(communicatedAt.getTime() + event.escalationIntervalMinutesSnapshot * 60_000)
    : event.nextEscalationDueAt;

  const communication = await prisma.$transaction(async (tx) => {
    const claimed = await claimCriticalCommunication(tx, {
      eventId: event.id,
      resultId: result.id,
      organizationId: session.user.organizationId,
      performingBranchId: result.performingBranchId,
      observedEscalationLevel: event.escalationLevel,
      observedUpdatedAt: event.updatedAt,
      outcome: outcome as "ACKNOWLEDGED" | "NO_ANSWER" | "LEFT_MESSAGE" | "FAILED" | "ESCALATED",
      communicatedAt,
      communicatorId: session.user.id,
      nextEscalationDueAt,
    });
    // Do not create clinical history or an audit for a stale event. The
    // claimant must reload the latest acknowledgement/escalation state.
    if (!claimed) return null;

    const created = await tx.criticalResultCommunication.create({
      data: {
        criticalEventId: event.id,
        method: method as "PHONE" | "VERBAL" | "EMAIL" | "SMS" | "WHATSAPP" | "OTHER",
        outcome: outcome as "ACKNOWLEDGED" | "NO_ANSWER" | "LEFT_MESSAGE" | "FAILED" | "ESCALATED",
        recipientName,
        recipientRole: recipientRole || null,
        recipientContact: recipientContact || null,
        acknowledgementConfirmed,
        readBackConfirmed,
        notes: notes || null,
        communicatedByUserId: session.user.id,
        communicatedAt,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: result.performingBranchId,
        actorUserId: session.user.id,
        action: "CRITICAL_RESULT_COMMUNICATED",
        entityType: "CriticalResultEvent",
        entityId: event.id,
        newValues: {
          resultId: result.id,
          method,
          outcome,
          recipientName,
          recipientRole: recipientRole || null,
          acknowledgementConfirmed,
          readBackConfirmed,
          escalationLevel: nextEscalationLevel,
          nextEscalationDueAt,
          communicatedAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });
  if (!communication) {
    return NextResponse.json({ error: "critical_event_state_changed_reload" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    communicationId: communication.id,
    criticalEventStatus: acknowledged ? "ACKNOWLEDGED" : event.status,
    escalationLevel: nextEscalationLevel,
    nextEscalationDueAt,
  }, { status: 201 });
}
