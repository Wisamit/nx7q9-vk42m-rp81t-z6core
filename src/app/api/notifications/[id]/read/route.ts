import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("notifications.view");
  const ctx = await requestContext();
  const { id } = await params;

  const notification = await prisma.notification.findFirst({
    where: {
      id,
      organizationId: session.user.organizationId,
      recipientUserId: session.user.id,
    },
    select: { id: true, readAt: true, branchId: true },
  });
  if (!notification) return NextResponse.json({ error: "notification_not_found" }, { status: 404 });
  if (notification.readAt) return NextResponse.json({ status: "ok" });

  const readAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.notification.update({ where: { id }, data: { readAt } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: notification.branchId,
        actorUserId: session.user.id,
        action: "NOTIFICATION_READ",
        entityType: "Notification",
        entityId: id,
        newValues: { readAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });
  return NextResponse.json({ status: "ok", readAt });
}
