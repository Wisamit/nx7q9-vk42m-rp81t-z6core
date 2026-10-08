import { Prisma } from "../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.training.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const userId = text(body.userId,36);
  const analyzerId = text(body.analyzerId,36) || null;
  const documentVersionId = text(body.documentVersionId,36) || null;
  const competencyName = text(body.competencyName,255);
  const assessmentMethod = text(body.assessmentMethod,255);
  const result = ["PASS","FAIL","CONDITIONAL"].includes(body.result) ? body.result : null;
  const assessedAt = body.assessedAt ? new Date(String(body.assessedAt)) : new Date();
  const nextDueAt = body.nextDueAt ? new Date(String(body.nextDueAt)) : null;
  const notes = text(body.notes) || null;
  const evidence = body.evidence === undefined || body.evidence === null ? Prisma.DbNull : body.evidence as Prisma.InputJsonValue;

  if (!userId || !competencyName || !assessmentMethod || !result || Number.isNaN(assessedAt.getTime()) || (nextDueAt && Number.isNaN(nextDueAt.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const [user, branchRecord, analyzer, documentVersion] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    analyzerId ? prisma.analyzer.findFirst({ where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    documentVersionId ? prisma.qualityDocumentVersion.findFirst({ where: { id: documentVersionId, status: "EFFECTIVE", document: { organizationId: session.user.organizationId } } }) : Promise.resolve(null),
  ]);

  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (analyzerId && (!analyzer || !canAccessBranch(session, analyzer.branchId))) return NextResponse.json({ error: "analyzer_not_found_or_forbidden" }, { status: 404 });
  if (documentVersionId && !documentVersion) return NextResponse.json({ error: "effective_document_version_required" }, { status: 409 });
  if (branchId && analyzer && analyzer.branchId !== branchId) return NextResponse.json({ error: "analyzer_branch_mismatch" }, { status: 409 });

  let assessment;
  try {
    assessment = await prisma.$transaction(async tx => {
      if (analyzerId) {
        // Grants and failed competency submissions lock the same analyzer row.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM analyzers WHERE id = ${analyzerId}
          AND organization_id = ${session.user.organizationId}
          AND status = 'ACTIVE' FOR UPDATE
        `;
        if (locked.length !== 1) throw new Error("ANALYZER_STATE_CHANGED");
      }
      const activeAuthorizations = analyzerId && result !== "PASS"
        ? await tx.analyzerAuthorization.findMany({
            where: { organizationId: session.user.organizationId, userId, analyzerId, status: "ACTIVE" },
            select: { id: true },
          }) : [];
      const created = await tx.competencyAssessment.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        userId,
        analyzerId,
        documentVersionId,
        competencyName,
        assessmentMethod,
        result,
        assessedByUserId: session.user.id,
        assessedAt,
        nextDueAt,
        evidence,
        notes,
      },
    });
    if (activeAuthorizations.length > 0) {
      await tx.analyzerAuthorization.updateMany({
        where: { id: { in: activeAuthorizations.map(item => item.id) }, organizationId: session.user.organizationId, status: "ACTIVE" },
        data: { status: "SUSPENDED" },
      });
      for (const authorization of activeAuthorizations) {
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: analyzer?.branchId || branchId || session.activeBranchId,
            actorUserId: session.user.id,
            action: "ANALYZER_AUTHORIZATION_AUTO_SUSPENDED",
            entityType: "AnalyzerAuthorization",
            entityId: authorization.id,
            oldValues: { status: "ACTIVE" },
            newValues: { status: "SUSPENDED", competencyAssessmentId: created.id, competencyResult: result },
            reason: "Analyzer authorization suspended because the latest competency assessment is not PASS",
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || analyzer?.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "COMPETENCY_ASSESSED",
        entityType: "CompetencyAssessment",
        entityId: created.id,
        newValues: { userId, analyzerId, result, assessedAt, nextDueAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
      return created;
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch {
    return NextResponse.json({ error: "competency_submission_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", competencyAssessment: assessment }, { status: 201 });
}
