import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("analyzers.replay");
  const ctx = await requestContext();
  const { id } = await params;

  const message = await prisma.analyzerMessage.findFirst({
    where: { id, analyzer: { organizationId: session.user.organizationId } },
    include: { analyzer: true },
  });
  if (!message) return NextResponse.json({ error: "analyzer_message_not_found" }, { status: 404 });
  if (!canAccessBranch(session, message.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!["ERROR","DEAD_LETTER"].includes(message.status)) {
    return NextResponse.json({ error: "message_not_replayable", status: message.status }, { status: 409 });
  }

  // The row was read before this transaction. A concurrent worker may have
  // retried, recovered or quarantined it in the meantime. Claim only its exact
  // failed revision; never reset a newer RECEIVED/PROCESSED message to RECEIVED.
  const outcome = await prisma.$transaction(async tx => {
    const claimed = await tx.analyzerMessage.updateMany({
      where: {
        id: message.id,
        status: { in: ["ERROR", "DEAD_LETTER"] },
        updatedAt: message.updatedAt,
        attempts: message.attempts,
        analyzer: { organizationId: session.user.organizationId, branchId: message.branchId },
      },
      data: {
        status: "RECEIVED",
        attempts: { increment: 1 },
        errorCode: null,
        errorText: null,
        processedAt: null,
      },
    });
    if (claimed.count !== 1) return { conflict: true as const };
    const nextAttempts = message.attempts + 1;
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: message.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_MESSAGE_REPLAY_QUEUED",
        entityType: "AnalyzerMessage",
        entityId: message.id,
        oldValues: { status: message.status, attempts: message.attempts, errorCode: message.errorCode },
        newValues: { status: "RECEIVED", attempts: nextAttempts },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { conflict: false as const, attempts: nextAttempts };
  });

  if (outcome.conflict) {
    return NextResponse.json({ error: "analyzer_message_replay_state_changed" }, { status: 409 });
  }
  return NextResponse.json({
    status: "ok", messageId: message.id, messageStatus: "RECEIVED", attempts: outcome.attempts,
  });
}
