import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { resolveAttachmentTarget } from "@/lib/attachment-target";
import { prisma } from "@/lib/db";
import { verifiedAttachmentBytes } from "@/lib/attachment-integrity";

function quotedFilename(value: string) {
  return value.replace(/[\r\n"]/g, "_");
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("attachments.view");
  const ctx = await requestContext();
  const { id } = await context.params;

  const attachment = await prisma.attachment.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { content: true },
  });
  if (!attachment?.content) return NextResponse.json({ error: "attachment_not_found" }, { status: 404 });

  const target = await resolveAttachmentTarget(session, attachment.targetType, attachment.targetId);
  if (!target) return NextResponse.json({ error: "attachment_not_found" }, { status: 404 });

  // Never serve a corrupted or incorrectly linked clinical/quality attachment.
  // The checksum belongs to the immutable attachment row and is checked over
  // the exact persisted bytes, not a client-supplied name or MIME type.
  const bytes = verifiedAttachmentBytes(attachment.content.data, attachment.sizeBytes, attachment.sha256);
  if (!bytes) {
    await prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: target.branchId,
        actorUserId: session.user.id,
        action: "ATTACHMENT_INTEGRITY_FAILURE",
        entityType: attachment.targetType,
        entityId: attachment.targetId,
        newValues: { attachmentId: attachment.id, sizeExpected: attachment.sizeBytes, integrity: "FAILED" },
        reason: "Protected attachment bytes differ from immutable SHA-256/length metadata",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return NextResponse.json({ error: "attachment_integrity_failure" }, {
      status: 409,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }

  await prisma.auditEvent.create({
    data: {
      organizationId: session.user.organizationId,
      branchId: target.branchId,
      actorUserId: session.user.id,
      action: "ATTACHMENT_DOWNLOADED",
      entityType: attachment.targetType,
      entityId: attachment.targetId,
      newValues: { attachmentId: attachment.id, sha256: attachment.sha256 },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `attachment; filename="${quotedFilename(attachment.originalName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
