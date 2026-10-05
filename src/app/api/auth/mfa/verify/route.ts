import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hashSessionToken, newSessionToken, requestContext, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeRecoveryCode, decryptSecret, hashOpaqueToken, verifyTotp } from "@/lib/staff-mfa";

const MFA_CHALLENGE_COOKIE = "family_lab_mfa_challenge";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return NextResponse.json({ error: "invalid_mfa_code" }, { status: 400 });

  const store = await cookies();
  const challengeToken = store.get(MFA_CHALLENGE_COOKIE)?.value;
  if (!challengeToken) return NextResponse.json({ error: "mfa_challenge_missing" }, { status: 401 });

  const context = await requestContext();
  const limiter = await checkRateLimit({
    scope: "staff_mfa_verify",
    key: (context.ipAddress || "unknown") + ":" + hashOpaqueToken(challengeToken),
    limit: 10,
    windowMs: 5 * 60_000,
  });
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const challenge = await prisma.staffMfaChallenge.findFirst({
    where: {
      tokenHash: hashOpaqueToken(challengeToken),
      consumedAt: null,
      expiresAt: { gt: new Date() },
      user: { status: "ACTIVE", mfaEnabled: true },
    },
    include: {
      user: {
        include: {
          branchScopes: { include: { branch: true } },
        },
      },
    },
  });
  if (!challenge?.user.mfaSecretEncrypted) {
    return NextResponse.json({ error: "mfa_challenge_invalid" }, { status: 401 });
  }

  const secret = decryptSecret(challenge.user.mfaSecretEncrypted);
  let valid = verifyTotp(secret, code);
  let remainingRecoveryCodes = Array.isArray(challenge.user.mfaRecoveryCodes)
    ? challenge.user.mfaRecoveryCodes.filter((value): value is string => typeof value === "string")
    : [];

  if (!valid && remainingRecoveryCodes.length > 0) {
    const recovery = await consumeRecoveryCode(code, remainingRecoveryCodes);
    valid = recovery.valid;
    remainingRecoveryCodes = recovery.remaining;
  }

  if (!valid) {
    await prisma.auditEvent.create({
      data: {
        organizationId: challenge.user.organizationId,
        branchId: challenge.user.branchScopes[0]?.branchId ?? null,
        actorUserId: challenge.user.id,
        action: "MFA_VERIFICATION_FAILED",
        entityType: "User",
        entityId: challenge.user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    return NextResponse.json({ error: "invalid_mfa_code" }, { status: 401 });
  }

  const activeBranch = challenge.user.branchScopes.find(scope => scope.branch.status === "ACTIVE")?.branch ?? null;
  if (!activeBranch) return NextResponse.json({ error: "no_active_branch_scope" }, { status: 403 });

  const sessionToken = newSessionToken();
  const expiresAt = sessionExpiry();

  await prisma.$transaction([
    prisma.staffMfaChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: challenge.user.id },
      data: {
        lastLoginAt: new Date(),
        mfaRecoveryCodes: remainingRecoveryCodes,
      },
    }),
    prisma.userSession.create({
      data: {
        userId: challenge.user.id,
        activeBranchId: activeBranch.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: challenge.user.organizationId,
        branchId: activeBranch.id,
        actorUserId: challenge.user.id,
        action: "LOGIN_SUCCEEDED_MFA",
        entityType: "User",
        entityId: challenge.user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
  ]);

  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(MFA_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
  });
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
