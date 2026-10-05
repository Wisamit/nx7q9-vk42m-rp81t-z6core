import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("integrations.api_keys.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const key = await prisma.integrationApiKey.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!key) return NextResponse.json({ error: "api_key_not_found" }, { status: 404 });
  if (key.revokedAt) return NextResponse.json({ status: "ok", revokedAt: key.revokedAt });

  const revokedAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.integrationApiKey.update({ where: { id }, data: { revokedAt } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTEGRATION_API_KEY_REVOKED",
        entityType: "IntegrationApiKey",
        entityId: id,
        oldValues: { revokedAt: null },
        newValues: { revokedAt, keyPrefix: key.keyPrefix },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });
  return NextResponse.json({ status: "ok", revokedAt });
}
