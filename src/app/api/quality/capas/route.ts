import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function capaNumber() {
  const day = new Date().toISOString().slice(0,10).replaceAll("-","");
  return `CAPA-${day}-${randomUUID().slice(0,8).toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.capa.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const nonconformanceId = text(body.nonconformanceId,36) || null;
  const title = text(body.title,255);
  const issueDescription = text(body.issueDescription);
  const rootCause = text(body.rootCause) || null;
  const ownerUserId = text(body.ownerUserId,36);
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;

  if (!title || !issueDescription || !ownerUserId || (dueDate && Number.isNaN(dueDate.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const [branchRecord, owner, nonconformance] = await Promise.all([
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    nonconformanceId ? prisma.nonconformance.findFirst({ where: { id: nonconformanceId, organizationId: session.user.organizationId } }) : Promise.resolve(null),
  ]);
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  if (nonconformanceId && !nonconformance) return NextResponse.json({ error: "nonconformance_not_found" }, { status: 404 });
  if (nonconformance?.branchId && !canAccessBranch(session, nonconformance.branchId)) {
    return NextResponse.json({ error: "nonconformance_branch_forbidden" }, { status: 403 });
  }
  if (nonconformance?.branchId && branchId && branchId !== nonconformance.branchId) {
    return NextResponse.json({ error: "capa_nonconformance_branch_mismatch" }, { status: 409 });
  }
  const effectiveBranchId = branchId || nonconformance?.branchId || null;

  let capa;
  try {
    capa = await prisma.$transaction(async tx => {
      if (nonconformanceId) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM nonconformances WHERE id = ${nonconformanceId}
          AND organization_id = ${session.user.organizationId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new Error("NONCONFORMANCE_CHANGED");
        const current = await tx.nonconformance.findUniqueOrThrow({ where: { id: nonconformanceId } });
        if (["CLOSED", "CANCELLED"].includes(current.status)) throw new Error("NONCONFORMANCE_LOCKED");
        if (current.branchId && effectiveBranchId !== current.branchId) throw new Error("NONCONFORMANCE_BRANCH_MISMATCH");
      }
      const created = await tx.capa.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: effectiveBranchId,
        capaNumber: capaNumber(),
        nonconformanceId,
        title,
        issueDescription,
        rootCause,
        ownerUserId,
        dueDate,
      },
    });
    if (nonconformance) {
      const current = await tx.nonconformance.findUniqueOrThrow({ where: { id: nonconformance.id } });
      await tx.nonconformance.update({
        where: { id: current.id },
        data: { status: "ACTION_REQUIRED", ownerUserId: current.ownerUserId || ownerUserId },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: nonconformance.branchId || effectiveBranchId || session.activeBranchId,
          actorUserId: session.user.id,
          action: "NONCONFORMANCE_LINKED_TO_CAPA",
          entityType: "Nonconformance",
          entityId: nonconformance.id,
          oldValues: { status: current.status, ownerUserId: current.ownerUserId },
          newValues: { status: "ACTION_REQUIRED", ownerUserId: current.ownerUserId || ownerUserId, capaId: created.id },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: effectiveBranchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "CAPA_CREATED",
        entityType: "Capa",
        entityId: created.id,
        newValues: { capaNumber: created.capaNumber, nonconformanceId, ownerUserId, dueDate },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
      return created;
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch {
    return NextResponse.json({ error: "capa_nonconformance_state_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", capa }, { status: 201 });
}
