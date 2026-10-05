import { compare } from "bcryptjs";
import { Prisma } from "../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { requestContext, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeRecoveryCode, decryptSecret, verifyTotp } from "@/lib/staff-mfa";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { currentPassword?: unknown; code?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!session.user.mfaEnabled || !session.user.mfaSecretEncrypted) {
    return NextResponse.json({ error: "mfa_not_enabled" }, { status: 409 });
  }
  if (!session.user.passwordHash || !(await compare(currentPassword, session.user.passwordHash))) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const secret = decryptSecret(session.user.mfaSecretEncrypted);
  let valid = verifyTotp(secret, code);
  const recoveryHashes = Array.isArray(session.user.mfaRecoveryCodes)
    ? session.user.mfaRecoveryCodes.filter((value): value is string => typeof value === "string")
    : [];
  if (!valid && recoveryHashes.length) {
    valid = (await consumeRecoveryCode(code, recoveryHashes)).valid;
  }
  if (!valid) return NextResponse.json({ error: "invalid_mfa_code" }, { status: 401 });

  const context = await requestContext();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaPendingSecretEncrypted: null,
        mfaConfirmedAt: null,
        mfaRecoveryCodes: Prisma.DbNull,
      },
    }),
    prisma.userSession.updateMany({
      where: { userId: session.user.id, id: { not: session.id }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "MFA_DISABLED",
        entityType: "User",
        entityId: session.user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
  ]);

  return NextResponse.json({ status: "ok" });
}
