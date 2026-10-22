import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const PORTAL_SESSION_COOKIE = "family_lab_portal_session";
const PORTAL_SESSION_HOURS = 12;

export function hashPortalToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newPortalToken() {
  return randomBytes(32).toString("base64url");
}

export function portalSessionExpiry() {
  return new Date(Date.now() + PORTAL_SESSION_HOURS * 60 * 60 * 1000);
}

export async function getCurrentPortalSession() {
  const store = await cookies();
  const token = store.get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) return null;

  return prisma.portalSession.findFirst({
    where: {
      tokenHash: hashPortalToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      portalAccount: { status: "ACTIVE", organization: { status: "ACTIVE" } },
    },
    include: {
      portalAccount: {
        include: {
          organization: true,
          patient: true,
          referrer: true,
          client: true,
          contactVerifications: {
            where: { revokedAt: null },
            orderBy: { verifiedAt: "desc" },
          },
        },
      },
    },
  });
}

export async function requirePortalSession() {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/login");
  if (session.portalAccount.mustChangePassword) redirect("/portal/change-password");
  return session;
}
