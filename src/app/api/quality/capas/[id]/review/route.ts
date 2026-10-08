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

  const capa = await prisma.capa.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { actions: true },
  });
  if (!capa) return NextResponse.json({ error: "capa_not_found" }, { status: 404 });
  if (capa.branchId && !canAccessBranch(session, capa.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (["CLOSED","CANCELLED"].includes(capa.status)) return NextResponse.json({ error: "capa_locked" }, { status: 409 });

  const effectiveness = ["EFFECTIVE","PARTIALLY_EFFECTIVE","INEFFECTIVE"].includes(body.effectiveness) ? body.effectiveness : null;
  const effectivenessReview = text(body.effectivenessReview);
  const close = body.close === true;
  if (!effectiveness || !effectivenessReview) return NextResponse.json({ error: "effectiveness_review_required" }, { status: 400 });
  const openActions = capa.actions.filter(action => !["COMPLETED","CANCELLED"].includes(action.status));
  if (openActions.length > 0) return NextResponse.json({ error: "open_capa_actions", count: openActions.length }, { status: 409 });
  if (close && effectiveness !== "EFFECTIVE") {
    return NextResponse.json({ error: "capa_must_be_effective_before_closure" }, { status: 409 });
  }

  const now = new Date();
  let saved;
  try {
    saved = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM capas WHERE id = ${id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("CAPA_STATE_CHANGED");
      const current = await tx.capa.findUniqueOrThrow({ where: { id } });
      if (["CLOSED", "CANCELLED"].includes(current.status)) throw new Error("CAPA_LOCKED");
      const remainingActions = await tx.capaAction.count({
        where: { capaId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      });
      if (remainingActions !== 0) throw new Error("OPEN_CAPA_ACTIONS");
      const claim = await tx.capa.updateMany({
        where: { id, organizationId: session.user.organizationId, status: current.status, updatedAt: current.updatedAt },
        data: {
        status: close ? "CLOSED" : "EFFECTIVENESS_REVIEW",
        effectiveness,
        effectivenessReview,
        effectivenessReviewedByUserId: session.user.id,
        effectivenessReviewedAt: now,
        closedByUserId: close ? session.user.id : null,
        closedAt: close ? now : null,
      },
    });
      if (claim.count !== 1) throw new Error("CAPA_STATE_CHANGED");
      const updated = await tx.capa.findUniqueOrThrow({ where: { id } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: capa.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: close ? "CAPA_CLOSED" : "CAPA_EFFECTIVENESS_REVIEWED",
        entityType: "Capa",
        entityId: id,
        oldValues: { status: capa.status, effectiveness: capa.effectiveness },
        newValues: { status: updated.status, effectiveness, reviewedAt: now },
        reason: effectivenessReview,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reason === "OPEN_CAPA_ACTIONS" ? "open_capa_actions" : "capa_review_conflict_or_locked" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", capa: saved });
}
