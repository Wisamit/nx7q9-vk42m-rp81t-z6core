import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentSession, requestContext, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateStaffPassword } from "@/lib/staff-password-policy";

class CredentialChangeError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode = 409) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const fields = body as Record<string, unknown>;
  const policy = validateStaffPassword(fields.newPassword, fields.confirmPassword);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });
  const currentPassword = typeof fields.currentPassword === "string" ? fields.currentPassword : "";
  if (!currentPassword) return NextResponse.json({ error: "current_password_required" }, { status: 400 });
  const ctx = await requestContext();
  const organizationId = session.user.organizationId;
  const userId = session.user.id;
  const limiter = await checkRateLimit({
    scope: "staff_password_change_identity",
    key: organizationId + ":" + userId,
    limit: 6,
    windowMs: 15 * 60_000,
  });
  if (!limiter.allowed)
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) },
    });
  try {
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${userId}
        AND organization_id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      if (locked.length !== 1) throw new CredentialChangeError("account_inactive", 403);
      const [user, liveSession] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, organizationId, status: "ACTIVE" } }),
        tx.userSession.findFirst({
          where: { id: session.id, userId, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        }),
      ]);
      if (!user || !liveSession || !user.passwordHash)
        throw new CredentialChangeError("session_expired", 401);
      if (!(await compare(currentPassword, user.passwordHash)))
        throw new CredentialChangeError("current_password_invalid", 401);
      if (await compare(fields.newPassword as string, user.passwordHash))
        throw new CredentialChangeError("new_password_must_differ", 400);
      const passwordHash = await hash(fields.newPassword as string, 12);
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash, passwordChangedAt: new Date(),
          failedLoginAttempts: 0, lockedUntil: null,
        },
      });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.staffMfaChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          organizationId, branchId: session.activeBranchId,
          actorUserId: userId, action: "STAFF_PASSWORD_CHANGED",
          entityType: "User", entityId: userId,
          newValues: {
            sessionsRevoked: true,
            pendingMfaChallengesRevoked: true,
            mfaPreserved: true,
            changedBySelf: true,
          },
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },
      });
    }, { isolationLevel: "Serializable", timeout: 45000 });
    const response = NextResponse.json({ status: "password_changed_sign_in_again" },
      { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", path: "/", maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof CredentialChangeError)
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    return NextResponse.json({ error: "credential_update_conflict" }, { status: 409 });
  }
}
