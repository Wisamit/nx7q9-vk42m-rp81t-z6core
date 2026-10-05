import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("portal_accounts.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const password = typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
  if (password.length < 12) return NextResponse.json({ error: "password_too_short" }, { status: 400 });

  const account = await prisma.portalAccount.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!account) return NextResponse.json({ error: "portal_account_not_found" }, { status: 404 });

  const passwordHash = await hash(password, 12);
  await prisma.$transaction([
    prisma.portalAccount.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        status: "ACTIVE",
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    }),
    prisma.portalSession.updateMany({
      where: { portalAccountId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PORTAL_TEMPORARY_PASSWORD_SET",
        entityType: "PortalAccount",
        entityId: id,
        newValues: { mustChangePassword: true, status: "ACTIVE" },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    }),
  ]);

  return NextResponse.json({ status: "ok" });
}
