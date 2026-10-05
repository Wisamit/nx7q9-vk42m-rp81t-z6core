import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { resolveAttachmentTarget } from "@/lib/attachment-target";
import { prisma } from "@/lib/db";

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

  return new NextResponse(new Uint8Array(attachment.content.data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `attachment; filename="${quotedFilename(attachment.originalName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
