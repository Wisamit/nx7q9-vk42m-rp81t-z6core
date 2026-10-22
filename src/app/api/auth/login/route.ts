import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { newSessionToken, hashSessionToken, requestContext, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashOpaqueToken, newMfaChallengeToken } from "@/lib/staff-mfa";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MFA_CHALLENGE_COOKIE = "family_lab_mfa_challenge";
const MFA_CHALLENGE_MINUTES = 5;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const context = await requestContext();
  const [ipLimit, identityLimit] = await Promise.all([
    checkRateLimit({ scope: "staff_login_ip", key: context.ipAddress || "unknown", limit: 30, windowMs: 15 * 60_000 }),
    checkRateLimit({ scope: "staff_login_identity", key: username, limit: 12, windowMs: 15 * 60_000 }),
  ]);
  if (!ipLimit.allowed || !identityLimit.allowed) {
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, identityLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const user = await prisma.user.findFirst({
    where: { username, status: "ACTIVE", organization: { status: "ACTIVE" } },
    include: { branchScopes: { include: { branch: true } } },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "account_temporarily_locked" }, { status: 423 });
  }

  const valid = await compare(password, user.passwordHash);

  if (!valid) {
    const failed = user.failedLoginAttempts + 1;
    const lockedUntil = failed >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
      : null;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lockedUntil ? 0 : failed,
          lockedUntil,
        },
      }),
      prisma.auditEvent.create({
        data: {
          organizationId: user.organizationId,
          branchId: user.branchScopes[0]?.branchId ?? null,
          actorUserId: user.id,
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: user.id,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      }),
    ]);

    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const activeBranch = user.branchScopes.find((scope) => scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === user.organizationId)?.branch ?? null;
  if (!activeBranch) {
    return NextResponse.json({ error: "no_active_branch_scope" }, { status: 403 });
  }

  if (user.mfaEnabled) {
    if (!user.mfaSecretEncrypted) {
      return NextResponse.json({ error: "mfa_configuration_invalid" }, { status: 503 });
    }
    const challengeToken = newMfaChallengeToken();
    const challengeExpiresAt = new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60_000);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      }),
      prisma.staffMfaChallenge.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(challengeToken),
          expiresAt: challengeExpiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      }),
      prisma.auditEvent.create({
        data: {
          organizationId: user.organizationId,
          branchId: activeBranch.id,
          actorUserId: user.id,
          action: "MFA_CHALLENGE_ISSUED",
          entityType: "User",
          entityId: user.id,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      }),
    ]);
    const response = NextResponse.json({ status: "mfa_required", mfaRequired: true }, { status: 202 });
    response.cookies.set(MFA_CHALLENGE_COOKIE, challengeToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: challengeExpiresAt,
    });
    return response;
  }

  const token = newSessionToken();
  const expiresAt = sessionExpiry();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    }),
    prisma.userSession.create({
      data: {
        userId: user.id,
        activeBranchId: activeBranch.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: user.organizationId,
        branchId: activeBranch.id,
        actorUserId: user.id,
        action: "LOGIN_SUCCEEDED",
        entityType: "User",
        entityId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    }),
  ]);

  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
