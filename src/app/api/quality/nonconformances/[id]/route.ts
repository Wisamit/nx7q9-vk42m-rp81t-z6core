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
  if (ownerUserId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } });
    if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  }

  const now = new Date();
  const updated = await prisma.$transaction(async tx => {
    const saved = await tx.nonconformance.update({
      where: { id },
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
  });

  return NextResponse.json({ status: "ok", nonconformance: updated });
}
