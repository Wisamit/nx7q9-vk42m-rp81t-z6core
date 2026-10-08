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
    // Explicit replay must not reset a message concurrently recovered or
    // claimed by the automated bridge; only the same failed revision wins.
    const claimed = await tx.analyzerMessage.updateMany({
      where: {
        id: message.id,
        status: { in: ["ERROR", "DEAD_LETTER"] },
        updatedAt: message.updatedAt,
      },
      data: {
        status: "RECEIVED",
        attempts: { increment: 1 },
        errorCode: null,
        errorText: null,
        processedAt: null,
      },
    });
    if (claimed.count !== 1) throw new Error("ANALYZER_MESSAGE_REPLAY_CONFLICT");
    const replayed = await tx.analyzerMessage.findUniqueOrThrow({ where: { id: message.id } });

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
  }).catch(error => {
    if (error instanceof Error && error.message === "ANALYZER_MESSAGE_REPLAY_CONFLICT") return null;
    throw error;
  });
  if (!updated) return NextResponse.json({ error: "analyzer_message_state_changed" }, { status: 409 });

  return NextResponse.json({ status: "ok", messageId: updated.id, messageStatus: updated.status, attempts: updated.attempts });
}
