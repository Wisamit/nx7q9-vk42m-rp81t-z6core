import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentPortalSession, PORTAL_SESSION_COOKIE } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";

export async function POST() {
  const session = await getCurrentPortalSession();
  if (session) {
    await prisma.portalSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
  const store = await cookies();
  store.delete(PORTAL_SESSION_COOKIE);
  return NextResponse.json({ status: "ok" });
}
