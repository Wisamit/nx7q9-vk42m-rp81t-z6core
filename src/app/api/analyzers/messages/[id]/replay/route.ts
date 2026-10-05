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

  const updated = await prisma.$transaction(async tx => {
    const replayed = await tx.analyzerMessage.update({
      where: { id: message.id },
      data: {
        status: "RECEIVED",
        attempts: { increment: 1 },
        errorCode: null,
        errorText: null,
        processedAt: null,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: message.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_MESSAGE_REPLAY_QUEUED",
        entityType: "AnalyzerMessage",
        entityId: message.id,
        oldValues: { status: message.status, attempts: message.attempts, errorCode: message.errorCode },
        newValues: { status: "RECEIVED", attempts: replayed.attempts },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return replayed;
  });

  return NextResponse.json({ status: "ok", messageId: updated.id, messageStatus: updated.status, attempts: updated.attempts });
}
