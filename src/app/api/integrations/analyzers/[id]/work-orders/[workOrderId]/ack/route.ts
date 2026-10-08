import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAnalyzerBridge } from "@/lib/analyzer-auth";
import { analyzerRetryDelaySeconds } from "@/lib/analyzer-work-orders";

/**
 * Acknowledgement is tied to a single leased attempt. Late acks from earlier
 * attempts cannot acknowledge a newer command delivery or erase a failure.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; workOrderId: string }> },
) {
  const { id, workOrderId } = await params;
  const credential = await authenticateAnalyzerBridge(request, id);
  if (!credential) return NextResponse.json({ error: "analyzer_bridge_unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { code, leaseToken, message } = body as Record<string, unknown>;
  if (code !== "ACCEPTED" && code !== "RETRY" && code !== "REJECTED") {
    return NextResponse.json({ error: "invalid_work_order_acknowledgement" }, { status: 400 });
  }
  if (typeof leaseToken !== "string" || !/^[0-9a-f]{64}$/.test(leaseToken)) {
    return NextResponse.json({ error: "invalid_claim_token" }, { status: 400 });
  }
  if (message !== undefined && (typeof message !== "string" || message.length > 2000)) {
    return NextResponse.json({ error: "invalid_acknowledgement_details" }, { status: 400 });
  }
  const claimTokenHash = createHash("sha256").update(leaseToken).digest("hex");
  const note = typeof message === "string" ? message.trim() : "";
  const now = new Date();

  const outcome = await prisma.$transaction(async tx => {
    const current = await tx.analyzerWorkOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId: credential.analyzer.organizationId,
        analyzerId: credential.analyzer.id,
        branchId: credential.analyzer.branchId,
      },
    });
    if (!current) return "NOT_FOUND" as const;
    if (current.status !== "CLAIMED" || current.claimTokenHash !== claimTokenHash) {
      return "STALE_CLAIM" as const;
    }

    const accepted = code === "ACCEPTED";
    const terminal = code === "REJECTED" || current.attemptCount >= current.maxAttempts;
    const nextStatus = accepted ? "ACKNOWLEDGED" : terminal ? "DEAD_LETTER" : "RETRY_WAIT";
    const nextAttemptAt = !accepted && !terminal
      ? new Date(now.getTime() + analyzerRetryDelaySeconds(current.attemptCount) * 1000)
      : null;
    const updated = await tx.analyzerWorkOrder.updateMany({
      where: {
        id: current.id,
        organizationId: credential.analyzer.organizationId,
        analyzerId: credential.analyzer.id,
        status: "CLAIMED",
        claimTokenHash,
        attemptCount: current.attemptCount,
        updatedAt: current.updatedAt,
      },
      data: {
        status: nextStatus,
        claimTokenHash: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        acknowledgedAt: accepted ? now : null,
        acknowledgement: `${code}${note ? ": " + note : ""}`,
        lastError: accepted ? null : note || `bridge_${code.toLowerCase()}`,
      },
    });
    if (updated.count !== 1) return "STALE_CLAIM" as const;

    await tx.auditEvent.create({
      data: {
        organizationId: credential.analyzer.organizationId,
        branchId: credential.analyzer.branchId,
        actorUserId: null,
        action: accepted ? "ANALYZER_WORK_ORDER_ACKNOWLEDGED" : "ANALYZER_WORK_ORDER_NOT_ACCEPTED",
        entityType: "AnalyzerWorkOrder",
        entityId: current.id,
        newValues: {
          analyzerId: current.analyzerId,
          attempt: current.attemptCount,
          code,
          status: nextStatus,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
        },
        reason: note || "Authenticated Analyzer Bridge acknowledgement",
      },
    });
    return { status: nextStatus, nextAttemptAt, workOrderId: current.id };
  });

  if (outcome === "NOT_FOUND") {
    return NextResponse.json({ error: "work_order_not_found" }, { status: 404 });
  }
  if (outcome === "STALE_CLAIM") {
    return NextResponse.json({ error: "work_order_lease_changed" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", ...outcome });
}
