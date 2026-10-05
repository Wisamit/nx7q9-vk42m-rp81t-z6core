import { NextResponse } from "next/server";
import { getCurrentSession, hashSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cookies } from "next/headers";

export async function POST() {
  const session = await getCurrentSession();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.userSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  if (session) {
    await prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.userId,
        action: "LOGOUT",
        entityType: "User",
        entityId: session.userId,
      },
    });
  }

  const response = NextResponse.json({ status: "ok" });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return response;
}
