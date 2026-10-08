import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { structuredStorageLocation } from "@/lib/specimen-storage-location";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const position = structuredStorageLocation(body?.storagePosition);
  if ("error" in position) return NextResponse.json({ error: position.error }, { status: 400 });
  const storageLocation = position.path;
  const reason = text(body?.reason, 1000);
  if (!storageLocation) return NextResponse.json({ error: "storage_location_required" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "storage_relocation_reason_required" }, { status: 400 });

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!["COLLECTED","RECEIVED","IN_PROCESS"].includes(specimen.status)) {
    return NextResponse.json({ error: "specimen_status_not_relocatable" }, { status: 409 });
  }

  const result = await prisma.$transaction(async tx => {
    const changed = await tx.specimen.updateMany({
      where: {
        id: specimen.id,
        organizationId: session.user.organizationId,
        status: specimen.status,
        currentBranchId: specimen.currentBranchId,
        updatedAt: specimen.updatedAt,
        preanalyticalVersion: specimen.preanalyticalVersion,
      },
      data: {
        storageLocation,
        preanalyticalVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;

    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "RELOCATED",
        branchId: specimen.currentBranchId!,
        actorUserId: session.user.id,
        fromStatus: specimen.status,
        toStatus: specimen.status,
        details: {
          relocationType: "PHYSICAL_STORAGE",
          previousStorageLocation: specimen.storageLocation,
          storageLocation,
          storagePosition: position.segments,
          reason,
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: specimen.organizationId,
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_STORAGE_RELOCATED",
        entityType: "Specimen",
        entityId: specimen.id,
        reason,
        oldValues: { storageLocation: specimen.storageLocation },
        newValues: { storageLocation, storagePosition: position.segments },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return true;
  });

  if (!result) return NextResponse.json({ error: "specimen_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", storageLocation });
}
