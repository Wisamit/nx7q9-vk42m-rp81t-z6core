import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.nonconformance.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const record = await prisma.nonconformance.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!record) return NextResponse.json({ error: "nonconformance_not_found" }, { status: 404 });
  if (record.branchId && !canAccessBranch(session, record.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (["CLOSED","CANCELLED"].includes(record.status)) return NextResponse.json({ error: "nonconformance_locked" }, { status: 409 });

  const status = ["OPEN","INVESTIGATING","ACTION_REQUIRED","CLOSED","CANCELLED"].includes(body.status) ? body.status : record.status;
  const rootCause = body.rootCause === undefined ? record.rootCause : text(body.rootCause) || null;
  const immediateAction = body.immediateAction === undefined ? record.immediateAction : text(body.immediateAction) || null;
  const closureSummary = body.closureSummary === undefined ? record.closureSummary : text(body.closureSummary) || null;
  const ownerUserId = body.ownerUserId === undefined ? record.ownerUserId : text(body.ownerUserId,36) || null;

  if (status === "CLOSED" && (!rootCause || !closureSummary)) {
    return NextResponse.json({ error: "root_cause_and_closure_required" }, { status: 409 });
  }
  if (status === "CLOSED") {
    const openCapaCount = await prisma.capa.count({
      where: {
        nonconformanceId: record.id,
        status: { notIn: ["CLOSED", "CANCELLED"] },
      },
    });
    if (openCapaCount > 0) {
      return NextResponse.json({ error: "open_capa_blocks_nonconformance_closure", openCapaCount }, { status: 409 });
    }
  }
  if (ownerUserId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } });
    if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  }

  const now = new Date();
  let updated;
  try {
    updated = await prisma.$transaction(async tx => {
      // CAPA creation takes the same parent lock before opening new work.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM nonconformances WHERE id = ${id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("NONCONFORMANCE_STATE_CHANGED");
      const current = await tx.nonconformance.findUniqueOrThrow({ where: { id } });
      if (["CLOSED", "CANCELLED"].includes(current.status) || current.updatedAt.getTime() !== record.updatedAt.getTime()) {
        throw new Error("NONCONFORMANCE_STATE_CHANGED");
      }
      if (status === "CLOSED") {
        const unfinished = await tx.capa.count({
          where: { nonconformanceId: id, status: { notIn: ["CLOSED", "CANCELLED"] } },
        });
        if (unfinished > 0) throw new Error("NONCONFORMANCE_HAS_OPEN_CAPA");
      }
      const claimed = await tx.nonconformance.updateMany({
        where: { id, organizationId: session.user.organizationId, status: current.status, updatedAt: current.updatedAt },
        data: {
        status,
        rootCause,
        immediateAction,
        closureSummary,
        ownerUserId,
        closedByUserId: status === "CLOSED" ? session.user.id : null,
        closedAt: status === "CLOSED" ? now : null,
      },
    });
      if (claimed.count !== 1) throw new Error("NONCONFORMANCE_STATE_CHANGED");
      const saved = await tx.nonconformance.findUniqueOrThrow({ where: { id } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: record.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: status === "CLOSED" ? "NONCONFORMANCE_CLOSED" : "NONCONFORMANCE_UPDATED",
        entityType: "Nonconformance",
        entityId: id,
        oldValues: { status: record.status, rootCause: record.rootCause, ownerUserId: record.ownerUserId },
        newValues: { status, rootCause, ownerUserId, closedAt: saved.closedAt },
        reason: status === "CLOSED" ? closureSummary : null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
      return saved;
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reason === "NONCONFORMANCE_HAS_OPEN_CAPA"
      ? "open_capa_blocks_nonconformance_closure" : "nonconformance_state_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", nonconformance: updated });
}
