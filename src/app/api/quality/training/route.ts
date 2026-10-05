import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validUrl(value: string | null) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:","https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.training.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const userId = text(body.userId,36);
  const documentVersionId = text(body.documentVersionId,36) || null;
  const analyzerId = text(body.analyzerId,36) || null;
  const title = text(body.title,255);
  const provider = text(body.provider,220) || null;
  const status = ["ASSIGNED","IN_PROGRESS","COMPLETED","WAIVED"].includes(body.status) ? body.status : "ASSIGNED";
  const assignedAt = body.assignedAt ? new Date(String(body.assignedAt)) : new Date();
  const completedAt = status === "COMPLETED" ? (body.completedAt ? new Date(String(body.completedAt)) : new Date()) : null;
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  const certificateStorageKey = text(body.certificateStorageKey,500) || null;
  const certificateUrl = text(body.certificateUrl,1000) || null;
  const notes = text(body.notes) || null;

  if (!userId || !title || Number.isNaN(assignedAt.getTime()) || (completedAt && Number.isNaN(completedAt.getTime())) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (!validUrl(certificateUrl)) return NextResponse.json({ error: "invalid_certificate_url" }, { status: 400 });

  const [user, branchRecord, analyzer, documentVersion] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    analyzerId ? prisma.analyzer.findFirst({ where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    documentVersionId ? prisma.qualityDocumentVersion.findFirst({
      where: { id: documentVersionId, status: "EFFECTIVE", document: { organizationId: session.user.organizationId } },
      include: { document: true },
    }) : Promise.resolve(null),
  ]);

  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (analyzerId && (!analyzer || !canAccessBranch(session, analyzer.branchId))) return NextResponse.json({ error: "analyzer_not_found_or_forbidden" }, { status: 404 });
  if (documentVersionId && !documentVersion) return NextResponse.json({ error: "effective_document_version_required" }, { status: 409 });
  if (branchId && analyzer && analyzer.branchId !== branchId) return NextResponse.json({ error: "analyzer_branch_mismatch" }, { status: 409 });
  if (branchId && documentVersion?.document.branchId && documentVersion.document.branchId !== branchId) return NextResponse.json({ error: "document_branch_mismatch" }, { status: 409 });

  const record = await prisma.$transaction(async tx => {
    const created = await tx.trainingRecord.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        userId,
        documentVersionId,
        analyzerId,
        title,
        provider,
        assignedAt,
        completedAt,
        expiresAt,
        status,
        certificateStorageKey,
        certificateUrl,
        notes,
        recordedByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || analyzer?.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "TRAINING_RECORD_CREATED",
        entityType: "TrainingRecord",
        entityId: created.id,
        newValues: { userId, documentVersionId, analyzerId, status, assignedAt, completedAt, expiresAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", trainingRecord: record }, { status: 201 });
}
