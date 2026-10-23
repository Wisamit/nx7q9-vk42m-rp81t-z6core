import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 12) return NextResponse.json({ error: "password_too_short" }, { status: 400 });

  const passwordHash = await hash(password, 12);
  try {
    await prisma.$transaction(async tx => {
      // A stale live cookie must never turn a subsequently disabled account
      // back to ACTIVE. The account row lock serializes login and revocation.
      const live = await tx.$queryRaw<Array<{id:string;status:string}>>`
        SELECT id,status FROM portal_accounts
        WHERE id=${session.portalAccountId}
          AND organization_id=${session.portalAccount.organizationId}
        FOR UPDATE
      `;
      if (live.length !== 1 || live[0].status !== "ACTIVE") {
        throw new Error("PORTAL_PASSWORD_PRINCIPAL_CHANGED");
      }
      // bcrypt runs outside this transaction. A patient merge, revoked
      // corporate client, disabled physician or tenant during hashing must
      // not leave a password rotation and audit for an invalid principal.
      const livePrincipal = await tx.$queryRaw<Array<{id:string}>>`
        SELECT a.id FROM portal_accounts a
        JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'
        LEFT JOIN patients p ON p.id=a.patient_id
        LEFT JOIN clients c ON c.id=a.client_id
        LEFT JOIN referrers r ON r.id=a.referrer_id
        WHERE a.id=${session.portalAccountId}
          AND a.organization_id=${session.portalAccount.organizationId}
          AND a.status='ACTIVE'
          AND a.type=${session.portalAccount.type}
          AND (
            (a.type='PATIENT' AND p.id=${session.portalAccount.patientId}
              AND p.status='ACTIVE' AND p.organization_id=a.organization_id)
            OR (a.type='CORPORATE' AND c.id=${session.portalAccount.clientId}
              AND c.status='ACTIVE' AND c.organization_id=a.organization_id)
            OR (a.type='DOCTOR' AND r.id=${session.portalAccount.referrerId}
              AND r.status='ACTIVE' AND r.type='PHYSICIAN'
              AND r.organization_id=a.organization_id)
          )
        FOR UPDATE
      `;
      if (livePrincipal.length !== 1) {
        throw new Error("PORTAL_PASSWORD_PRINCIPAL_CHANGED");
      }
      const currentSession = await tx.portalSession.findFirst({
        where: {
          id: session.id,
          portalAccountId: session.portalAccountId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!currentSession) throw new Error("PORTAL_PASSWORD_SESSION_REVOKED");

      // Never set status to ACTIVE here; an administrator's disabled state
      // cannot be overridden by a password-change request.
      const changed = await tx.portalAccount.updateMany({
        where: {
          id: session.portalAccountId,
          organizationId: session.portalAccount.organizationId,
          status: "ACTIVE",
        },
        data: { passwordHash, mustChangePassword: false },
      });
      if (changed.count !== 1) throw new Error("PORTAL_PASSWORD_PRINCIPAL_CHANGED");

      // The current browser may continue to the portal after first login.
      // Other sessions (including stolen cookies) must reauthenticate.
      const revoked = await tx.portalSession.updateMany({
        where: {
          portalAccountId: session.portalAccountId,
          id: { not: session.id },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.portalAccount.organizationId,
          actorUserId: null,
          action: "PORTAL_PASSWORD_CHANGED",
          entityType: "PortalAccount",
          entityId: session.portalAccountId,
          sessionId: session.id,
          newValues: { otherSessionsRevoked: revoked.count },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    if (error instanceof Error &&
        ["PORTAL_PASSWORD_PRINCIPAL_CHANGED", "PORTAL_PASSWORD_SESSION_REVOKED"].includes(error.message)) {
      return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
    }
    throw error;
  }

  return NextResponse.json({ status: "ok" });
}
