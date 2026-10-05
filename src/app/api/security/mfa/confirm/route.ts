import { NextResponse } from "next/server";
import { requestContext, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret, hashRecoveryCodes, newRecoveryCodes, verifyTotp } from "@/lib/staff-mfa";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const pending = session.user.mfaPendingSecretEncrypted;
  if (!pending) return NextResponse.json({ error: "mfa_enrollment_not_started" }, { status: 409 });

  const secret = decryptSecret(pending);
  if (!verifyTotp(secret, code)) {
    return NextResponse.json({ error: "invalid_mfa_code" }, { status: 401 });
  }

  const recoveryCodes = newRecoveryCodes();
  const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
  const context = await requestContext();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: {
        mfaEnabled: true,
        mfaSecretEncrypted: pending,
        mfaPendingSecretEncrypted: null,
        mfaConfirmedAt: new Date(),
        mfaRecoveryCodes: recoveryHashes,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "MFA_ENABLED",
        entityType: "User",
        entityId: session.user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
  ]);

  return NextResponse.json({ status: "ok", recoveryCodes });
}
