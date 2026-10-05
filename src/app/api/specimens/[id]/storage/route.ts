import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const { id } = await params;
  const body = await request.json().catch(() => null) as { storageLocation?: unknown } | null;
  const storageLocation = typeof body?.storageLocation === "string" ? body.storageLocation.trim().slice(0, 255) : "";

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId, kind: "ALIQUOT" },
  });
  if (!specimen) return NextResponse.json({ error: "aliquot_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  await prisma.$transaction([
    prisma.specimen.update({ where: { id: specimen.id }, data: { storageLocation: storageLocation || null } }),
    prisma.specimenEvent.create({
      data: {
        specimenId: specimen.id, eventType: "RELOCATED", branchId: specimen.currentBranchId,
        actorUserId: session.user.id, fromStatus: specimen.status, toStatus: specimen.status,
        details: { fromStorageLocation: specimen.storageLocation, toStorageLocation: storageLocation || null },
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId, branchId: specimen.currentBranchId, actorUserId: session.user.id,
        action: "ALIQUOT_STORAGE_RELOCATED", entityType: "Specimen", entityId: specimen.id,
        oldValues: { storageLocation: specimen.storageLocation }, newValues: { storageLocation: storageLocation || null },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      },
    }),
  ]);
  return NextResponse.json({ status: "ok", storageLocation: storageLocation || null });
}
