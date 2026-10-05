import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.capa.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const capa = await prisma.capa.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!capa) return NextResponse.json({ error: "capa_not_found" }, { status: 404 });
  if (capa.branchId && !canAccessBranch(session, capa.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (["CLOSED","CANCELLED"].includes(capa.status)) return NextResponse.json({ error: "capa_locked" }, { status: 409 });

  const actionType = ["CORRECTIVE","PREVENTIVE"].includes(body.actionType) ? body.actionType : null;
  const description = text(body.description);
  const ownerUserId = text(body.ownerUserId,36) || null;
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  if (!actionType || !description || (dueDate && Number.isNaN(dueDate.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (ownerUserId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } });
    if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  }

  const action = await prisma.$transaction(async tx => {
    const created = await tx.capaAction.create({ data: { capaId: id, actionType, description, ownerUserId, dueDate } });
    if (capa.status === "OPEN") await tx.capa.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: capa.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "CAPA_ACTION_CREATED",
        entityType: "CapaAction",
        entityId: created.id,
        newValues: { capaId: id, actionType, ownerUserId, dueDate },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });
  return NextResponse.json({ status: "ok", action }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.capa.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { actionId?: string; status?: string } | null;
  const actionId = text(body?.actionId,36);
  const status = ["OPEN","IN_PROGRESS","COMPLETED","CANCELLED"].includes(body?.status || "") ? body!.status! : null;
  if (!actionId || !status) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const action = await prisma.capaAction.findFirst({
    where: { id: actionId, capaId: id, capa: { organizationId: session.user.organizationId } },
    include: { capa: true },
  });
  if (!action) return NextResponse.json({ error: "capa_action_not_found" }, { status: 404 });
  if (action.capa.branchId && !canAccessBranch(session, action.capa.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const saved = await prisma.$transaction(async tx => {
    const updated = await tx.capaAction.update({
      where: { id: action.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: action.capa.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "CAPA_ACTION_STATUS_CHANGED",
        entityType: "CapaAction",
        entityId: action.id,
        oldValues: { status: action.status },
        newValues: { status, completedAt: updated.completedAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });
  return NextResponse.json({ status: "ok", action: saved });
}
