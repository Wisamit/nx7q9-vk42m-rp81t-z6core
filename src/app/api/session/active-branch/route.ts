import { NextResponse } from "next/server";
import { canAccessBranch, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { branchId?: unknown } | null;
  const branchId = typeof body?.branchId === "string" ? body.branchId.trim() : "";

  if (!branchId) return NextResponse.json({ error: "branch_required" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { activeBranchId: branchId, lastSeenAt: new Date() },
  });

  return NextResponse.json({ status: "ok", activeBranchId: branchId });
}
