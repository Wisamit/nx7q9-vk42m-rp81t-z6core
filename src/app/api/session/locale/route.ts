import { NextResponse } from "next/server";
import { requestContext, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { locale?: unknown } | null;
  const locale = body?.locale === "ar" ? "ar" : body?.locale === "en" ? "en" : null;
  if (!locale) return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  if (locale === session.user.preferredLocale) {
    return NextResponse.json({ status: "ok", locale });
  }

  const ctx = await requestContext();
  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { preferredLocale: locale },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "USER_LOCALE_CHANGED",
        entityType: "User",
        entityId: session.user.id,
        oldValues: { preferredLocale: session.user.preferredLocale },
        newValues: { preferredLocale: locale },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok", locale });
}
