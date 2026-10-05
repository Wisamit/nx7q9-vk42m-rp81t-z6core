import { compare } from "bcryptjs";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { requestContext, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret, newTotpSecret, totpUri } from "@/lib/staff-mfa";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { currentPassword?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  if (!currentPassword || !session.user.passwordHash) {
    return NextResponse.json({ error: "invalid_password" }, { status: 400 });
  }
  if (session.user.mfaEnabled) {
    return NextResponse.json({ error: "mfa_already_enabled" }, { status: 409 });
  }
  const validPassword = await compare(currentPassword, session.user.passwordHash);
  if (!validPassword) return NextResponse.json({ error: "invalid_password" }, { status: 401 });

  const secret = newTotpSecret();
  const uri = totpUri(secret, session.user.username, session.user.organization.nameEn || session.user.organization.code);
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 220, margin: 1 });
  const context = await requestContext();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: { mfaPendingSecretEncrypted: encryptSecret(secret) },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "MFA_ENROLLMENT_STARTED",
        entityType: "User",
        entityId: session.user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
  ]);

  return NextResponse.json({ secret, otpauthUri: uri, qrDataUrl });
}
