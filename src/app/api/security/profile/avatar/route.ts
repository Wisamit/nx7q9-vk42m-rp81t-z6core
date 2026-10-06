import { NextResponse } from "next/server";
import { requireSession, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function validateAvatar(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return undefined;
  if (value.length > 1_400_000) return undefined;
  return value;
}

export async function PUT(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const avatarDataUrl = validateAvatar(body.avatarDataUrl);
  if (avatarDataUrl === undefined) return NextResponse.json({ error: "invalid_avatar" }, { status: 400 });

  const ctx = await requestContext();
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { avatarDataUrl },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "USER_AVATAR_UPDATED",
        entityType: "User",
        entityId: session.user.id,
        newValues: { avatarConfigured: Boolean(avatarDataUrl) },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok" });
}
