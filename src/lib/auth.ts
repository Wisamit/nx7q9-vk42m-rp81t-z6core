import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { branchScopeAllows } from "@/lib/clinical-safety";

export const SESSION_COOKIE = "family_lab_session";
const SESSION_DAYS = 7;

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export async function requestContext() {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) || null,
  };
}

export async function getCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return prisma.userSession.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { status: "ACTIVE" },
    },
    include: {
      user: {
        include: {
          organization: true,
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          branchScopes: { include: { branch: true } },
        },
      },
      activeBranch: true,
    },
  });
}

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export function permissionSet(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>) {
  return new Set(
    session.user.roles.flatMap((assignment) =>
      assignment.role.permissions.map((grant) => grant.permission.code),
    ),
  );
}

export async function requirePermission(code: string) {
  const session = await requireSession();
  const permissions = permissionSet(session);
  if (!permissions.has(code)) redirect("/dashboard?forbidden=1");
  return session;
}

export function canAccessBranch(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
  branchId: string,
) {
  return branchScopeAllows(
    session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId),
    branchId,
  );
}
