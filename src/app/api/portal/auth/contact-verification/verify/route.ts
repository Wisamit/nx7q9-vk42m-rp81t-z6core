import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { hasLivePortalContactPrincipal } from "@/lib/portal-contact-principal";
import { prisma } from "@/lib/db";
import { requestContext } from "@/lib/auth";
import { maskedDestination } from "@/lib/report-outbound";
import { portalOtpAttemptGuard } from "@/lib/portal-otp-attempt-guard";

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  const account = session.portalAccount;
  if (account.mustChangePassword) {
    return NextResponse.json({ error: "password_change_required" }, { status: 409 });
  }
  // Revocation/merge/tenant reassignment must invalidate contact proof, even
  // if an old portal session cookie remains active.
  if (!hasLivePortalContactPrincipal(account)) {
    return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
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
    // Atomic attempt accounting prevents parallel incorrect guesses from
    // exceeding maxAttempts or updating a consumed/expired challenge.
    const attempted = await prisma.portalOtpChallenge.updateMany({
      where: portalOtpAttemptGuard(challenge, new Date()),
      data: { attempts: { increment: 1 } },
    });
    if (attempted.count !== 1) {
      return NextResponse.json({ error: "verification_challenge_unavailable" }, { status: 409 });
    }
    return NextResponse.json({ error: "invalid_verification_code" }, { status: 400 });
  }

  const verifiesEmail = Boolean(account.email && challenge.destination.toLowerCase() === account.email.toLowerCase());
  const verifiesPhone = Boolean(account.phone && challenge.destination.replace(/\s+/g, "") === account.phone.replace(/\s+/g, ""));
  if (!verifiesEmail && !verifiesPhone) {
    return NextResponse.json({ error: "verification_destination_changed" }, { status: 409 });
  }

  const verificationChannel = verifiesEmail ? "EMAIL" as const : "PHONE" as const;
  const currentDestination = verifiesEmail ? account.email : account.phone;
  if (!currentDestination) {
    return NextResponse.json({ error: "verification_destination_changed" }, { status: 409 });
  }

  const verifiedAt = new Date();
  try {
    await prisma.$transaction(async tx => {
      // Recheck every OTP safety condition atomically at claim time:
      // another concurrent attempt may have exhausted the budget, consumed
      // the OTP, changed its destination or reached its expiry meanwhile.
      const consumed = await tx.portalOtpChallenge.updateMany({
        where: portalOtpAttemptGuard(challenge, verifiedAt),
        data: { consumedAt: verifiedAt },
      });
      if (consumed.count !== 1) throw new Error("PORTAL_VERIFICATION_CONFLICT");

      const claimedAccount = await tx.portalAccount.updateMany({
        where: verifiesEmail
          ? { id: account.id, email: currentDestination }
          : { id: account.id, phone: currentDestination },
        data: {
          contactVerifiedAt: verifiedAt,
          ...(verifiesEmail ? { emailVerifiedAt: verifiedAt } : { phoneVerifiedAt: verifiedAt }),
        },
      });
      if (claimedAccount.count !== 1) throw new Error("PORTAL_VERIFICATION_DESTINATION_CHANGED");

      await tx.portalContactVerification.updateMany({
        where: {
          portalAccountId: account.id,
          channel: verificationChannel,
          revokedAt: null,
        },
        data: { revokedAt: verifiedAt },
      });

      const verification = await tx.portalContactVerification.create({
        data: {
          portalAccountId: account.id,
          channel: verificationChannel,
          destinationSnapshot: currentDestination.trim(),
          method: "SELF_SERVICE_OTP",
          verificationReason: "Self-service OTP verification",
          verifiedByUserId: null,
          verifiedAt,
        },
      });

      await tx.notification.updateMany({
        where: {
          eventCode: "PORTAL_VERIFY_CONTACT",
          entityType: "PortalOtpChallenge",
          entityId: challenge.id,
        },
        data: { body: "Verification code consumed." },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: account.organizationId,
          actorUserId: null,
          action: "PORTAL_CONTACT_VERIFIED",
          entityType: "PortalAccount",
          entityId: account.id,
          sessionId: session.id,
          newValues: {
            verificationId: verification.id,
            channel: verificationChannel,
            method: "SELF_SERVICE_OTP",
            challengeId: challenge.id,
            destinationMasked: maskedDestination(verifiesEmail ? "EMAIL" : "SMS", currentDestination),
            verifiedAt: verifiedAt.toISOString(),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PORTAL_VERIFICATION_DESTINATION_CHANGED") {
      return NextResponse.json({ error: "verification_destination_changed" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PORTAL_VERIFICATION_CONFLICT") {
      return NextResponse.json({ error: "verification_challenge_consumed" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({
    status: "verified",
    emailVerifiedAt: verifiesEmail ? verifiedAt.toISOString() : account.emailVerifiedAt?.toISOString() || null,
    phoneVerifiedAt: verifiesPhone ? verifiedAt.toISOString() : account.phoneVerifiedAt?.toISOString() || null,
  });
}
