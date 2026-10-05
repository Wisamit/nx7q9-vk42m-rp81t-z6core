import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.training.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const userId = text(body.userId,36);
  const analyzerId = text(body.analyzerId,36);
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  const scopeNotes = text(body.scopeNotes) || null;
  if (!userId || !analyzerId || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const [user, analyzer, existing, competency] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.analyzer.findFirst({ where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.analyzerAuthorization.findFirst({ where: { organizationId: session.user.organizationId, userId, analyzerId, status: "ACTIVE" } }),
    prisma.competencyAssessment.findFirst({
      where: { organizationId: session.user.organizationId, userId, analyzerId },
      orderBy: { assessedAt: "desc" },
    }),
  ]);
  if (!user || !analyzer) return NextResponse.json({ error: "user_or_analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (existing) return NextResponse.json({ error: "active_authorization_exists" }, { status: 409 });
  const today = new Date();
  if (!competency || competency.result !== "PASS" || (competency.nextDueAt && competency.nextDueAt < today)) {
    return NextResponse.json({ error: "current_passing_competency_required" }, { status: 409 });
  }

  const authorization = await prisma.$transaction(async tx => {
    const created = await tx.analyzerAuthorization.create({
      data: {
        organizationId: session.user.organizationId,
        userId,
        analyzerId,
        expiresAt,
        scopeNotes,
        approvedByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_AUTHORIZATION_GRANTED",
        entityType: "AnalyzerAuthorization",
        entityId: created.id,
        newValues: { userId, analyzerId, competencyAssessmentId: competency.id, expiresAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });
  return NextResponse.json({ status: "ok", authorization }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requirePermission("quality.training.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  const id = text(body?.id,36);
  const status = ["SUSPENDED","REVOKED"].includes(body?.status) ? body.status : null;
  const revocationReason = text(body?.revocationReason);
  if (!id || !status || !revocationReason) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const authorization = await prisma.analyzerAuthorization.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { analyzer: true },
  });
  if (!authorization) return NextResponse.json({ error: "authorization_not_found" }, { status: 404 });
  if (!canAccessBranch(session, authorization.analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (authorization.status !== "ACTIVE") return NextResponse.json({ error: "authorization_not_active" }, { status: 409 });

  const saved = await prisma.$transaction(async tx => {
    const updated = await tx.analyzerAuthorization.update({
      where: { id },
      data: {
        status,
        revokedAt: status === "REVOKED" ? new Date() : null,
        revocationReason,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: authorization.analyzer.branchId,
        actorUserId: session.user.id,
        action: status === "REVOKED" ? "ANALYZER_AUTHORIZATION_REVOKED" : "ANALYZER_AUTHORIZATION_SUSPENDED",
        entityType: "AnalyzerAuthorization",
        entityId: id,
        oldValues: { status: authorization.status },
        newValues: { status },
        reason: revocationReason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });
  return NextResponse.json({ status: "ok", authorization: saved });
}
