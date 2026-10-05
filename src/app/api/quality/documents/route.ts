import { Prisma } from "../../../../../generated/prisma/client";
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
  const session = await requirePermission("quality.documents.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const code = text(body.code,80).toUpperCase();
  const titleEn = text(body.titleEn,255);
  const titleAr = text(body.titleAr,255) || null;
  const documentType = ["SOP","POLICY","WORK_INSTRUCTION","FORM","CHECKLIST","OTHER"].includes(body.documentType) ? body.documentType : null;
  const ownerUserId = text(body.ownerUserId,36) || null;
  const storageKey = text(body.storageKey,500) || null;
  const externalUrl = text(body.externalUrl,1000) || null;
  const changeSummary = text(body.changeSummary,1000) || "Initial version";
  const reviewDueAt = body.reviewDueAt ? new Date(String(body.reviewDueAt)) : null;
  const contentSnapshot = body.contentSnapshot === undefined || body.contentSnapshot === null
    ? Prisma.DbNull
    : body.contentSnapshot as Prisma.InputJsonValue;

  if (!code || !titleEn || !documentType || (!storageKey && !externalUrl && body.contentSnapshot == null)) {
    return NextResponse.json({ error: "missing_document_content_or_reference" }, { status: 400 });
  }
  if (!validUrl(externalUrl)) return NextResponse.json({ error: "invalid_external_url" }, { status: 400 });
  if (reviewDueAt && Number.isNaN(reviewDueAt.getTime())) return NextResponse.json({ error: "invalid_review_due_date" }, { status: 400 });

  const [branchRecord, owner, duplicate] = await Promise.all([
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    ownerUserId ? prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    prisma.qualityDocument.findFirst({ where: { organizationId: session.user.organizationId, code } }),
  ]);
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (ownerUserId && !owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  if (duplicate) return NextResponse.json({ error: "document_code_exists" }, { status: 409 });

  const document = await prisma.$transaction(async tx => {
    const created = await tx.qualityDocument.create({
      data: { organizationId: session.user.organizationId, branchId, code, titleEn, titleAr, documentType, ownerUserId },
    });
    await tx.qualityDocumentVersion.create({
      data: {
        documentId: created.id,
        version: 1,
        contentSnapshot,
        storageKey,
        externalUrl,
        changeSummary,
        reviewDueAt,
        submittedByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITY_DOCUMENT_CREATED",
        entityType: "QualityDocument",
        entityId: created.id,
        newValues: { code, documentType, branchId, version: 1 },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", document }, { status: 201 });
}
