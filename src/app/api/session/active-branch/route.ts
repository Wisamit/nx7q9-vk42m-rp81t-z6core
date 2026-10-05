import { NextResponse } from "next/server";
import { canAccessBranch, requestContext, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await requireSession();
  const body = await request.json().catch(() => null) as { branchId?: unknown } | null;
  const branchId = typeof body?.branchId === "string" ? body.branchId.trim() : "";

  if (!branchId) return NextResponse.json({ error: "branch_required" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  await prisma.$transaction(async tx => {
    await tx.userSession.update({
      where: { id: session.id },
      data: { activeBranchId: branchId, lastSeenAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "ACTIVE_BRANCH_CHANGED",
        entityType: "UserSession",
        entityId: session.id,
        oldValues: { activeBranchId: session.activeBranchId },
        newValues: { activeBranchId: branchId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });

  return NextResponse.json({ status: "ok", activeBranchId: branchId });
}
