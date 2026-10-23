import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requestContext } from "@/lib/auth";
import { hashPortalToken, newPortalToken, portalSessionExpiry, PORTAL_SESSION_COOKIE } from "@/lib/portal-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { portalLoginStillUniquelyOwned } from "@/lib/portal-login-identity";

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

  const [ipLimit, identityLimit] = await Promise.all([
    checkRateLimit({ scope: "portal_login_ip", key: ctx.ipAddress || "unknown", limit: 40, windowMs: 15 * 60_000 }),
    checkRateLimit({ scope: "portal_login_identity", key: organizationCode + ":" + login, limit: 12, windowMs: 15 * 60_000 }),
  ]);
  if (!ipLimit.allowed || !identityLimit.allowed) {
    const retryAfter = Math.max(ipLimit.retryAfterSeconds, identityLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // Neither normalizedEmail nor normalizedPhone is unique in the legacy-compatible
  // schema. Never let findFirst choose an arbitrary identity when two portal
  // accounts share an email, phone, or email/phone cross-match in a tenant.
  const matches = await prisma.portalAccount.findMany({
    where: {
      organization: { code: organizationCode, status: "ACTIVE" },
      OR: [{ normalizedEmail: login }, { normalizedPhone: login }],
    },
    take: 2,
  });
  const account = matches.length === 1 ? matches[0] : null;
  if (!account || !account.passwordHash || account.status === "DISABLED") {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  if (account.lockedUntil && account.lockedUntil > new Date()) {
    return NextResponse.json({ error: "portal_account_temporarily_locked" }, { status: 423 });
  }

  const ok = await compare(password, account.passwordHash);
  if (!ok) {
    try {
      await prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM portal_accounts WHERE id = ${account.id}
          AND organization_id = ${account.organizationId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new Error("PORTAL_ACCOUNT_CHANGED");
        const current = await tx.portalAccount.findUniqueOrThrow({ where: { id: account.id } });
        // Contact ownership and tenant status may change during bcrypt comparison.
        // Revalidate inside the same Serializable transaction as audit/session.
        const [organization, currentOwners] = await Promise.all([
          tx.organization.findUnique({
            where: { id: account.organizationId }, select: { status: true },
          }),
          tx.portalAccount.findMany({
            where: {
              organizationId: account.organizationId,
              OR: [{ normalizedEmail: login }, { normalizedPhone: login }],
            },
            select: { id: true }, take: 2,
          }),
        ]);
        if (organization?.status !== "ACTIVE" ||
            !portalLoginStillUniquelyOwned(current, login, currentOwners.map(owner=>owner.id))) {
          throw new Error("PORTAL_LOGIN_IDENTITY_CHANGED");
        }
        // A valid contact is not enough if the patient/client/physician linked
        // before bcrypt was merged, disabled or moved to another tenant.
        // Check in this locked transaction before any session, audit or lockout.
        const livePrincipal = await tx.$queryRaw<Array<{id:string}>>`
          SELECT a.id FROM portal_accounts a
          JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'
          LEFT JOIN patients p ON p.id=a.patient_id
          LEFT JOIN clients c ON c.id=a.client_id
          LEFT JOIN referrers r ON r.id=a.referrer_id
          WHERE a.id=${account.id} AND a.organization_id=${account.organizationId}
            AND a.status IN ('ACTIVE','LOCKED') AND a.type=${account.type}
            AND (
              (a.type='PATIENT' AND p.id=${account.patientId}
                AND p.status='ACTIVE' AND p.organization_id=a.organization_id)
              OR (a.type='CORPORATE' AND c.id=${account.clientId}
                AND c.status='ACTIVE' AND c.organization_id=a.organization_id)
              OR (a.type='DOCTOR' AND r.id=${account.referrerId}
                AND r.status='ACTIVE' AND r.type='PHYSICIAN'
                AND r.organization_id=a.organization_id)
            )
          FOR UPDATE
        `;
        if (livePrincipal.length !== 1) throw new Error("PORTAL_LOGIN_PRINCIPAL_CHANGED");
        if (current.status === "DISABLED") throw new Error("ACCOUNT_DISABLED");
        // Do not count a failed comparison against a password that was replaced meanwhile.
        if (current.passwordHash !== account.passwordHash) throw new Error("PASSWORD_CHANGED");
        const attempts = current.failedLoginAttempts + 1;
        const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null;
        await tx.portalAccount.update({
          where: { id: account.id },
          data: {
            failedLoginAttempts: lock ? 0 : attempts,
            lockedUntil: lock,
            status: lock ? "LOCKED" : current.status,
          },
        });
        await tx.auditEvent.create({
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
        });
      }, { isolationLevel: "Serializable", timeout: 30000 });
    } catch {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = newPortalToken();
  const expiresAt = portalSessionExpiry();
  let session;
  try {
    session = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM portal_accounts WHERE id = ${account.id}
        AND organization_id = ${account.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("PORTAL_ACCOUNT_CHANGED");
      const current = await tx.portalAccount.findUniqueOrThrow({ where: { id: account.id } });
      // Contact ownership and tenant status may change during bcrypt comparison.
      // Revalidate inside the same Serializable transaction as audit/session.
      const [organization, currentOwners] = await Promise.all([
        tx.organization.findUnique({
          where: { id: account.organizationId }, select: { status: true },
        }),
        tx.portalAccount.findMany({
          where: {
            organizationId: account.organizationId,
            OR: [{ normalizedEmail: login }, { normalizedPhone: login }],
          },
          select: { id: true }, take: 2,
        }),
      ]);
      if (organization?.status !== "ACTIVE" ||
          !portalLoginStillUniquelyOwned(current, login, currentOwners.map(owner=>owner.id))) {
        throw new Error("PORTAL_LOGIN_IDENTITY_CHANGED");
      }
      // A valid contact is not enough if the patient/client/physician linked
      // before bcrypt was merged, disabled or moved to another tenant.
      // Check in this locked transaction before any session, audit or lockout.
      const livePrincipal = await tx.$queryRaw<Array<{id:string}>>`
        SELECT a.id FROM portal_accounts a
        JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'
        LEFT JOIN patients p ON p.id=a.patient_id
        LEFT JOIN clients c ON c.id=a.client_id
        LEFT JOIN referrers r ON r.id=a.referrer_id
        WHERE a.id=${account.id} AND a.organization_id=${account.organizationId}
          AND a.status IN ('ACTIVE','LOCKED') AND a.type=${account.type}
          AND (
            (a.type='PATIENT' AND p.id=${account.patientId}
              AND p.status='ACTIVE' AND p.organization_id=a.organization_id)
            OR (a.type='CORPORATE' AND c.id=${account.clientId}
              AND c.status='ACTIVE' AND c.organization_id=a.organization_id)
            OR (a.type='DOCTOR' AND r.id=${account.referrerId}
              AND r.status='ACTIVE' AND r.type='PHYSICIAN'
              AND r.organization_id=a.organization_id)
          )
        FOR UPDATE
      `;
      if (livePrincipal.length !== 1) throw new Error("PORTAL_LOGIN_PRINCIPAL_CHANGED");
      if (current.status === "DISABLED" || current.passwordHash !== account.passwordHash ||
          (current.lockedUntil && current.lockedUntil > new Date())) {
        throw new Error("PORTAL_ACCOUNT_CHANGED");
      }
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
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

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
