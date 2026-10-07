import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { requestContext } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  const account = session.portalAccount;
  if (account.mustChangePassword) {
    return NextResponse.json({ error: "password_change_required" }, { status: 409 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as { challengeId?: string; code?: string } | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim().slice(0, 36) : "";
  const code = typeof body?.code === "string" ? body.code.trim().replace(/\D/g, "").slice(0, 6) : "";
  if (!challengeId || code.length !== 6) {
    return NextResponse.json({ error: "invalid_verification_code" }, { status: 400 });
  }

  const challenge = await prisma.portalOtpChallenge.findFirst({
    where: {
      id: challengeId,
      portalAccountId: account.id,
      purpose: "VERIFY_CONTACT",
      consumedAt: null,
    },
  });
  if (!challenge) return NextResponse.json({ error: "verification_challenge_not_found" }, { status: 404 });
  if (challenge.expiresAt <= new Date()) {
    return NextResponse.json({ error: "verification_code_expired" }, { status: 410 });
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return NextResponse.json({ error: "verification_attempts_exceeded" }, { status: 429 });
  }

  const ok = await compare(code, challenge.codeHash);
  if (!ok) {
    await prisma.portalOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "invalid_verification_code" }, { status: 400 });
  }

  const verifiesEmail = Boolean(account.email && challenge.destination.toLowerCase() === account.email.toLowerCase());
  const verifiesPhone = Boolean(account.phone && challenge.destination.replace(/\s+/g, "") === account.phone.replace(/\s+/g, ""));
  if (!verifiesEmail && !verifiesPhone) {
    return NextResponse.json({ error: "verification_destination_changed" }, { status: 409 });
  }

  const verifiedAt = new Date();
  await prisma.$transaction([
    prisma.portalOtpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: verifiedAt },
    }),
    prisma.portalAccount.update({
      where: { id: account.id },
      data: {
        contactVerifiedAt: verifiedAt,
        ...(verifiesEmail ? { emailVerifiedAt: verifiedAt } : {}),
        ...(verifiesPhone ? { phoneVerifiedAt: verifiedAt } : {}),
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: account.organizationId,
        actorUserId: null,
        action: "PORTAL_CONTACT_VERIFIED",
        entityType: "PortalAccount",
        entityId: account.id,
        sessionId: session.id,
        newValues: {
          channel: verifiesEmail ? "EMAIL" : "SMS",
          challengeId: challenge.id,
          verifiedAt: verifiedAt.toISOString(),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    }),
  ]);

  return NextResponse.json({
    status: "verified",
    emailVerifiedAt: verifiesEmail ? verifiedAt.toISOString() : account.emailVerifiedAt?.toISOString() || null,
    phoneVerifiedAt: verifiesPhone ? verifiedAt.toISOString() : account.phoneVerifiedAt?.toISOString() || null,
  });
}
