import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 12) return NextResponse.json({ error: "password_too_short" }, { status: 400 });

  const passwordHash = await hash(password, 12);
  await prisma.$transaction([
    prisma.portalAccount.update({
      where: { id: session.portalAccountId },
      data: {
        passwordHash,
        mustChangePassword: false,
        status: "ACTIVE",
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.portalAccount.organizationId,
        actorUserId: null,
        action: "PORTAL_PASSWORD_CHANGED",
        entityType: "PortalAccount",
        entityId: session.portalAccountId,
        sessionId: session.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    }),
  ]);

  return NextResponse.json({ status: "ok" });
}
