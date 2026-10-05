import { Prisma } from "../../../../../../generated/prisma/client";
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.documents.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const document = await prisma.qualityDocument.findFirst({
    where: { id, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!document) return NextResponse.json({ error: "quality_document_not_found" }, { status: 404 });
  if (document.branchId && !canAccessBranch(session, document.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const latest = document.versions[0] || null;
  if (latest && ["DRAFT","IN_REVIEW","APPROVED"].includes(latest.status)) {
    return NextResponse.json({ error: "unreleased_document_version_exists", version: latest.version, status: latest.status }, { status: 409 });
  }

  const storageKey = text(body.storageKey,500) || null;
  const externalUrl = text(body.externalUrl,1000) || null;
  const changeSummary = text(body.changeSummary,1000);
  const reviewDueAt = body.reviewDueAt ? new Date(String(body.reviewDueAt)) : null;
  const contentSnapshot = body.contentSnapshot === undefined || body.contentSnapshot === null
    ? Prisma.DbNull
    : body.contentSnapshot as Prisma.InputJsonValue;

  if (!changeSummary || (!storageKey && !externalUrl && body.contentSnapshot == null)) {
    return NextResponse.json({ error: "version_content_and_change_summary_required" }, { status: 400 });
  }
  if (!validUrl(externalUrl)) return NextResponse.json({ error: "invalid_external_url" }, { status: 400 });
  if (reviewDueAt && Number.isNaN(reviewDueAt.getTime())) return NextResponse.json({ error: "invalid_review_due_date" }, { status: 400 });

  const version = await prisma.$transaction(async tx => {
    const created = await tx.qualityDocumentVersion.create({
      data: {
        documentId: document.id,
        version: (latest?.version || 0) + 1,
        contentSnapshot,
        storageKey,
        externalUrl,
        changeSummary,
        reviewDueAt,
        submittedByUserId: session.user.id,
        supersedesVersionId: latest?.id || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: document.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITY_DOCUMENT_VERSION_CREATED",
        entityType: "QualityDocumentVersion",
        entityId: created.id,
        newValues: { documentId: document.id, version: created.version, supersedesVersionId: latest?.id || null },
        reason: changeSummary,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", version }, { status: 201 });
}
