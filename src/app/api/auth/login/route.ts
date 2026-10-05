import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { newSessionToken, hashSessionToken, requestContext, sessionExpiry, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const user = await prisma.user.findFirst({
    where: { username, status: "ACTIVE" },
    include: { branchScopes: { include: { branch: true } } },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "account_temporarily_locked" }, { status: 423 });
  }

  const valid = await compare(password, user.passwordHash);
  const context = await requestContext();

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

  const activeBranch = user.branchScopes.find((scope) => scope.branch.status === "ACTIVE")?.branch ?? null;
  if (!activeBranch) {
    return NextResponse.json({ error: "no_active_branch_scope" }, { status: 403 });
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
