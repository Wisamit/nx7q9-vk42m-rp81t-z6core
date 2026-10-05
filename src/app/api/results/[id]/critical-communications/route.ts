import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
    include: { criticalEvents: true },
  });
  if (!result) return NextResponse.json({ error: "result_not_found" }, { status: 404 });
  if (!canAccessBranch(session, result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!["VERIFIED","RELEASED"].includes(result.status)) {
    return NextResponse.json({ error: "result_not_eligible_for_critical_communication", status: result.status }, { status: 409 });
  }

  const event = result.criticalEvents[0];
  if (!event) return NextResponse.json({ error: "critical_event_not_found" }, { status: 404 });

  const communicatedAt = new Date();
  const acknowledged = outcome === "ACKNOWLEDGED" && acknowledgementConfirmed;

  const communication = await prisma.$transaction(async (tx) => {
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

    if (acknowledged) {
      await tx.criticalResultEvent.update({
        where: { id: event.id },
        data: {
          status: "ACKNOWLEDGED",
          acknowledgedAt: communicatedAt,
          acknowledgedByUserId: session.user.id,
        },
      });
    }

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
          communicatedAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });

  return NextResponse.json({
    status: "ok",
    communicationId: communication.id,
    criticalEventStatus: acknowledged ? "ACKNOWLEDGED" : event.status,
  }, { status: 201 });
}
