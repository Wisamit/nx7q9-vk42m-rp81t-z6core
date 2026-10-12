import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hashSessionToken, newSessionToken, requestContext, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeRecoveryCode, decryptSecret, hashOpaqueToken, verifyTotp } from "@/lib/staff-mfa";
import { canFinalizeMfaChallenge } from "@/lib/mfa-challenge-fencing";

const MFA_CHALLENGE_COOKIE = "family_lab_mfa_challenge";

class MfaVerificationError extends Error {
  constructor(readonly code: string, readonly statusCode = 401) {
    super(code);
  }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const code = body && typeof body === "object" && !Array.isArray(body) &&
    typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code.trim() : "";
  if (!code || code.length > 32)
    return NextResponse.json({ error: "invalid_mfa_code" }, { status: 400 });

  const store = await cookies();
  const challengeToken = store.get(MFA_CHALLENGE_COOKIE)?.value;
  if (!challengeToken) return NextResponse.json({ error: "mfa_challenge_missing" }, { status: 401 });
  const tokenHash = hashOpaqueToken(challengeToken);
  const context = await requestContext();
  const limiter = await checkRateLimit({
    scope: "staff_mfa_verify",
    key: (context.ipAddress || "unknown") + ":" + tokenHash,
    limit: 10, windowMs: 5 * 60_000,
  });
  if (!limiter.allowed) return NextResponse.json(
    { error: "rate_limited" }, { status: 429,
      headers: { "Retry-After": String(limiter.retryAfterSeconds) } });

  // Discover the tenant user ID only. All authorization and OTP verification
  // happen again inside the transaction after row locks are acquired.
  const pending = await prisma.staffMfaChallenge.findUnique({
    where: { tokenHash }, select: { id: true, userId: true },
  });
  if (!pending) return NextResponse.json({ error: "mfa_challenge_invalid" }, { status: 401 });

  const sessionToken = newSessionToken();
  const expiresAt = sessionExpiry();
  try {
    await prisma.$transaction(async tx => {
      // All password changes lock the user row. Acquire the same lock first
      // to fence password-reset vs challenge completion without deadlocks.
      const lockedUser = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${pending.userId} FOR UPDATE
      `;
      if (lockedUser.length !== 1) throw new MfaVerificationError("mfa_challenge_invalid");
      const lockedChallenge = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM staff_mfa_challenges WHERE id = ${pending.id}
        AND user_id = ${pending.userId} AND token_hash = ${tokenHash} FOR UPDATE
      `;
      if (lockedChallenge.length !== 1) throw new MfaVerificationError("mfa_challenge_invalid");
      const challenge = await tx.staffMfaChallenge.findUnique({
        where: { id: pending.id },
        include: { user: { include: {
          organization: true, branchScopes: { include: { branch: true } },
        } } },
      });
      if (!challenge || challenge.tokenHash !== tokenHash ||
          !canFinalizeMfaChallenge({
            consumedAt: challenge.consumedAt, expiresAt: challenge.expiresAt,
            createdAt: challenge.createdAt,
            passwordChangedAt: challenge.user.passwordChangedAt,
            userStatus: challenge.user.status,
            organizationStatus: challenge.user.organization.status,
            mfaEnabled: challenge.user.mfaEnabled,
            hasSecret: Boolean(challenge.user.mfaSecretEncrypted),
          }, new Date())) throw new MfaVerificationError("mfa_challenge_invalid");

      const activeBranch = challenge.user.branchScopes.find(scope =>
        scope.branch.status === "ACTIVE" &&
        scope.branch.organizationId === challenge.user.organizationId)?.branch;
      if (!activeBranch) throw new MfaVerificationError("no_active_branch_scope", 403);
      const secret = decryptSecret(challenge.user.mfaSecretEncrypted!);
      let valid = verifyTotp(secret, code);
      let remainingRecoveryCodes = Array.isArray(challenge.user.mfaRecoveryCodes)
        ? challenge.user.mfaRecoveryCodes.filter((value): value is string => typeof value === "string")
        : [];
      if (!valid && remainingRecoveryCodes.length > 0) {
        const recovery = await consumeRecoveryCode(code, remainingRecoveryCodes);
        valid = recovery.valid;
        remainingRecoveryCodes = recovery.remaining;
      }
      if (!valid) throw new MfaVerificationError("invalid_mfa_code");

      const claimed = await tx.staffMfaChallenge.updateMany({
        where: { id: challenge.id, userId: challenge.userId,
          tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw new MfaVerificationError("mfa_challenge_already_used");

      await tx.user.update({
        where: { id: challenge.user.id },
        data: { lastLoginAt: new Date(), mfaRecoveryCodes: remainingRecoveryCodes },
      });
      await tx.userSession.create({
        data: {
          userId: challenge.user.id, activeBranchId: activeBranch.id,
          tokenHash: hashSessionToken(sessionToken), expiresAt,
          ipAddress: context.ipAddress, userAgent: context.userAgent,
        },
      });
      await tx.auditEvent.create({ data: {
        organizationId: challenge.user.organizationId,
        branchId: activeBranch.id, actorUserId: challenge.user.id,
        action: "LOGIN_SUCCEEDED_MFA",
        entityType: "User", entityId: challenge.user.id,
        newValues: { challengeId: challenge.id, singleUseClaim: true },
        ipAddress: context.ipAddress, userAgent: context.userAgent,
      } });
    }, { isolationLevel: "Serializable", timeout: 45000 });

    const response = NextResponse.json({ status: "ok" },
      { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(MFA_CHALLENGE_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "strict", path: "/", expires: new Date(0),
    });
    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", path: "/", expires: expiresAt,
    });
    return response;
  } catch (error) {
    if (error instanceof MfaVerificationError) {
      // Failed verification must be retained in the security audit, but a
      // failed transaction must never consume the challenge or recovery code.
      if (error.code === "invalid_mfa_code") {
        const user = await prisma.user.findUnique({ where: { id: pending.userId },
          select: { organizationId: true } });
        if (user) await prisma.auditEvent.create({ data: {
          organizationId: user.organizationId, actorUserId: pending.userId,
          action: "MFA_VERIFICATION_FAILED",
          entityType: "User", entityId: pending.userId,
          ipAddress: context.ipAddress, userAgent: context.userAgent,
        } });
      }
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "mfa_verification_concurrent_conflict" }, { status: 409 });
  }
}
