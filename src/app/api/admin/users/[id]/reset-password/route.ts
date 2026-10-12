import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isActiveSystemAdmin, passwordResetReason, staffCredentialTargetAllowed,
  validateStaffPassword,
} from "@/lib/staff-password-policy";

class ResetError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode = 409) {
    super(code); this.code = code; this.statusCode = statusCode;
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("users.manage") ||
      !isActiveSystemAdmin(session.user.roles))
    return NextResponse.json({ error: "system_admin_required" }, { status: 403 });
  const organizationId = session.user.organizationId;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === organizationId))
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id) || id === session.user.id)
    return NextResponse.json({ error: "cannot_reset_own_password_here" }, { status: 400 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = input as Record<string, unknown>;
  const passwordProblem = validateStaffPassword(body.newPassword, body.confirmPassword);
  if (passwordProblem) return NextResponse.json({ error: passwordProblem }, { status: 400 });
  const reason = passwordResetReason(body.reason);
  if (!reason) return NextResponse.json({ error: "recovery_reason_required" }, { status: 400 });
  const actorPassword = typeof body.actorPassword === "string" ? body.actorPassword : "";
  if (!actorPassword) return NextResponse.json({ error: "actor_password_required" }, { status: 400 });
  const contextInfo = await requestContext();
  const limiter = await checkRateLimit({
    scope: "staff_password_reset_admin",
    key: organizationId + ":" + session.user.id,
    limit: 5, windowMs: 15 * 60_000,
  });
  if (!limiter.allowed)
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) },
    });
  try {
    await prisma.$transaction(async tx => {
      const organization = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations
        WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      const branch = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM branches WHERE id = ${branchId}
        AND organization_id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      const grant = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: session.user.id, branchId } },
        select: { branchId: true },
      });
      if (organization.length !== 1 || branch.length !== 1 || !grant)
        throw new ResetError("active_branch_scope_required", 403);
      const actorLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${session.user.id}
        AND organization_id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if (actorLock.length !== 1) throw new ResetError("actor_inactive", 403);
      const [actor, liveSession] = await Promise.all([
        tx.user.findFirst({
          where: { id: session.user.id, organizationId, status: "ACTIVE" },
          include: {
            roles: { include: { role: { include: {
              permissions: { include: { permission: true } },
            } } } },
          },
        }),
        tx.userSession.findFirst({
          where: { id: session.id, userId: session.user.id,
            revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true },
        }),
      ]);
      if (!actor || !liveSession || !actor.passwordHash ||
          !isActiveSystemAdmin(actor.roles) ||
          !actor.roles.some(a => a.role.status === "ACTIVE" &&
            a.role.permissions.some(p => p.permission.code === "users.manage")))
        throw new ResetError("system_admin_required", 403);
      if (!(await compare(actorPassword, actor.passwordHash)))
        throw new ResetError("actor_password_invalid", 401);
      const targetLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE id = ${id}
        AND organization_id = ${organizationId} FOR UPDATE
      `;
      if (targetLock.length !== 1) throw new ResetError("target_not_found", 404);
      const target = await tx.user.findFirst({
        where: { id, organizationId },
        select: { id: true, organizationId: true, status: true, username: true },
      });
      if (!target || !staffCredentialTargetAllowed({
        actorId: actor.id, targetId: id,
        actorOrganizationId: organizationId, targetOrganizationId: target.organizationId,
        actorIsSystemAdmin: true, actorHasManagePermission: true,
        targetStatus: target.status,
      })) throw new ResetError("target_not_active_or_authorized", 403);
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await hash(body.newPassword as string, 12),
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Challenges issued before a reset may not remain usable.
      await tx.staffMfaChallenge.updateMany({
        where: { userId: id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          organizationId, branchId, actorUserId: session.user.id,
          action: "STAFF_PASSWORD_ADMIN_RESET",
          entityType: "User", entityId: id, reason,
          newValues: {
            targetUsername: target.username, resetBy: session.user.id,
            sessionsRevoked: true, pendingMfaChallengesRevoked: true,
            mfaPreserved: true, permissionsPreserved: true,
          },
          ipAddress: contextInfo.ipAddress, userAgent: contextInfo.userAgent,
        },
      });
    }, { isolationLevel: "Serializable", timeout: 45000 });
    return NextResponse.json({ status: "password_reset_all_target_sessions_revoked" },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ResetError)
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    return NextResponse.json({ error: "credential_reset_conflict" }, { status: 409 });
  }
}
