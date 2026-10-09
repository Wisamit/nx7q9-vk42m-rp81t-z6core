import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("portal_accounts.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = body?.status === "DISABLED" ? "DISABLED" : body?.status === "ACTIVE" ? "ACTIVE" : null;
  if (!status) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

  const account = await prisma.portalAccount.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!account) return NextResponse.json({ error: "portal_account_not_found" }, { status: 404 });

  try {
    await prisma.$transaction(async tx => {
      // Login transactions must claim the same account row before creating sessions.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM portal_accounts WHERE id = ${id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("PORTAL_ACCOUNT_CHANGED");
      const current = await tx.portalAccount.findUniqueOrThrow({ where: { id } });
      if (current.updatedAt.getTime() !== account.updatedAt.getTime()) throw new Error("PORTAL_ACCOUNT_CHANGED");
      await tx.portalAccount.update({
      where: { id },
      data: {
        status,
        deactivatedAt: status === "DISABLED" ? new Date() : null,
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });
    if (status === "DISABLED") {
      await tx.portalSession.updateMany({
        where: { portalAccountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PORTAL_ACCOUNT_STATUS_CHANGED",
        entityType: "PortalAccount",
        entityId: id,
        oldValues: { status: account.status },
        newValues: { status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch {
    return NextResponse.json({ error: "portal_account_status_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", portalAccountStatus: status });
}
