import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requestContext } from "@/lib/auth";
import { hashPortalToken, newPortalToken, portalSessionExpiry, PORTAL_SESSION_COOKIE } from "@/lib/portal-auth";

function normalize(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed.replace(/[^0-9+]/g, "");
}

export async function POST(request: Request) {
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  const organizationCode = typeof body?.organizationCode === "string" ? body.organizationCode.trim().toUpperCase().slice(0, 50) : "";
  const login = normalize(body?.login);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!organizationCode || !login || !password) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const account = await prisma.portalAccount.findFirst({
    where: {
      organization: { code: organizationCode, status: "ACTIVE" },
      OR: [{ normalizedEmail: login }, { normalizedPhone: login }],
    },
  });
  if (!account || !account.passwordHash || account.status === "DISABLED") {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  if (account.lockedUntil && account.lockedUntil > new Date()) {
    return NextResponse.json({ error: "portal_account_temporarily_locked" }, { status: 423 });
  }

  const ok = await compare(password, account.passwordHash);
  if (!ok) {
    const attempts = account.failedLoginAttempts + 1;
    const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
    await prisma.$transaction([
      prisma.portalAccount.update({
        where: { id: account.id },
        data: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock,
          status: lock ? "LOCKED" : account.status,
        },
      }),
      prisma.auditEvent.create({
        data: {
          organizationId: account.organizationId,
          actorUserId: null,
          action: "PORTAL_LOGIN_FAILED",
          entityType: "PortalAccount",
          entityId: account.id,
          newValues: { locked: Boolean(lock) },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      }),
    ]);
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = newPortalToken();
  const expiresAt = portalSessionExpiry();
  const session = await prisma.$transaction(async tx => {
    const created = await tx.portalSession.create({
      data: {
        portalAccountId: account.id,
        tokenHash: hashPortalToken(token),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt,
      },
    });
    await tx.portalAccount.update({
      where: { id: account.id },
      data: {
        status: "ACTIVE",
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: account.organizationId,
        actorUserId: null,
        action: "PORTAL_LOGIN_SUCCEEDED",
        entityType: "PortalAccount",
        entityId: account.id,
        sessionId: created.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  const store = await cookies();
  store.set(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return NextResponse.json({
    status: "ok",
    accountType: account.type,
    mustChangePassword: account.mustChangePassword,
    sessionId: session.id,
  });
}
