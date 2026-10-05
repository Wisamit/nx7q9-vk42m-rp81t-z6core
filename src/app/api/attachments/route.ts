import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AttachmentTargetType } from "../../../../generated/prisma/client";
import { requirePermission, requestContext } from "@/lib/auth";
import { resolveAttachmentTarget } from "@/lib/attachment-target";
import { prisma } from "@/lib/db";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function targetType(value: string | null): AttachmentTargetType | null {
  return Object.values(AttachmentTargetType).includes(value as AttachmentTargetType)
    ? value as AttachmentTargetType
    : null;
}

function safeFilename(value: string) {
  const basename = value.replace(/\\/g, "/").split("/").pop() || "attachment";
  return basename.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "attachment";
}

export async function GET(request: NextRequest) {
  const session = await requirePermission("attachments.view");
  const type = targetType(request.nextUrl.searchParams.get("targetType"));
  const targetId = request.nextUrl.searchParams.get("targetId")?.trim() || "";
  if (!type || !targetId) return NextResponse.json({ error: "target_required" }, { status: 400 });

  const target = await resolveAttachmentTarget(session, type, targetId);
  if (!target) return NextResponse.json({ error: "target_not_found_or_forbidden" }, { status: 404 });

  const attachments = await prisma.attachment.findMany({
    where: {
      organizationId: session.user.organizationId,
      targetType: type,
      targetId,
    },
    select: {
      id: true,
      originalName: true,
      contentType: true,
      sizeBytes: true,
      sha256: true,
      createdAt: true,
      uploadedBy: { select: { displayNameEn: true, displayNameAr: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ target, attachments });
}

export async function POST(request: NextRequest) {
  const session = await requirePermission("attachments.upload");
  const ctx = await requestContext();
  const form = await request.formData();
  const type = targetType(typeof form.get("targetType") === "string" ? String(form.get("targetType")) : null);
  const targetId = typeof form.get("targetId") === "string" ? String(form.get("targetId")).trim() : "";
  const file = form.get("file");

  if (!type || !targetId || !(file instanceof File)) {
    return NextResponse.json({ error: "target_and_file_required" }, { status: 400 });
  }

  const target = await resolveAttachmentTarget(session, type, targetId);
  if (!target) return NextResponse.json({ error: "target_not_found_or_forbidden" }, { status: 404 });
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "attachment_size_invalid", maxBytes: MAX_ATTACHMENT_BYTES }, { status: 413 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "attachment_type_not_allowed", contentType: file.type }, { status: 415 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const originalName = safeFilename(file.name);

  const duplicate = await prisma.attachment.findFirst({
    where: {
      organizationId: session.user.organizationId,
      targetType: type,
      targetId,
      sha256,
    },
    select: { id: true },
  });
  if (duplicate) return NextResponse.json({ error: "duplicate_attachment", attachmentId: duplicate.id }, { status: 409 });

  const attachment = await prisma.$transaction(async tx => {
    const created = await tx.attachment.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: target.branchId,
        targetType: type,
        targetId,
        originalName,
        contentType: file.type,
        sizeBytes: file.size,
        sha256,
        uploadedByUserId: session.user.id,
      },
    });
    await tx.attachmentContent.create({
      data: { attachmentId: created.id, data: bytes },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: target.branchId,
        actorUserId: session.user.id,
        action: "ATTACHMENT_UPLOADED",
        entityType: type,
        entityId: targetId,
        newValues: {
          attachmentId: created.id,
          originalName,
          contentType: file.type,
          sizeBytes: file.size,
          sha256,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", attachment }, { status: 201 });
}
