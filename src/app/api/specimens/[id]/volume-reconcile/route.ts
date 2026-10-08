import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reconciledVolumeError, reconciliationUsageFloorError } from "@/lib/specimen-volume-policy";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const availableVolume = typeof body?.availableVolume === "string" || typeof body?.availableVolume === "number"
    ? String(body.availableVolume) : "";
  const availableVolumeUnit = text(body?.availableVolumeUnit, 30) || null;
  const reason = text(body?.reason, 1000);
  if (!reason) return NextResponse.json({ error: "reconciliation_reason_required" }, { status: 400 });

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const policyError = reconciledVolumeError({
    status: specimen.status,
    originalVolume: specimen.volume?.toFixed(3) || null,
    originalVolumeUnit: specimen.volumeUnit,
    trackedVolumeUnit: specimen.volumeUnit || specimen.remainingVolumeUnit,
    availableVolume,
    availableVolumeUnit,
  });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 409 });

  let result: boolean | null;
  try {
  result = await prisma.$transaction(async tx => {
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
        remainingVolume: availableVolume,
        preanalyticalVersion: { increment: 1 },
        remainingVolumeUnit: availableVolumeUnit,
      },
    });
    if (changed.count !== 1) return null;
    // Lock the specimen version before checking allocations. Usage writes
    // serialize on this version, so consumed volume cannot be reintroduced.
    const usage = await tx.specimenUsageEvent.aggregate({
      where: { specimenId: specimen.id },
      _sum: { volumeUsed: true },
    });
    const usageFloorError = reconciliationUsageFloorError({
      originalVolume: specimen.volume?.toFixed(3) || null,
      availableVolume,
      usageTotal: usage._sum.volumeUsed?.toFixed(3) || "0.000",
    });
    if (usageFloorError) throw new Error(usageFloorError);

    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "VOLUME_RECONCILED",
        branchId: specimen.currentBranchId!,
        actorUserId: session.user.id,
        fromStatus: specimen.status,
        toStatus: specimen.status,
        details: {
          previousRemainingVolume: specimen.remainingVolume?.toFixed(3) || null,
          previousRemainingVolumeUnit: specimen.remainingVolumeUnit,
          remainingVolume: availableVolume,
          remainingVolumeUnit: availableVolumeUnit,
          reason,
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: specimen.organizationId,
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_VOLUME_RECONCILED",
        entityType: "Specimen",
        entityId: specimen.id,
        reason,
        oldValues: {
          remainingVolume: specimen.remainingVolume?.toFixed(3) || null,
          remainingVolumeUnit: specimen.remainingVolumeUnit,
        },
        newValues: {
          remainingVolume: availableVolume,
          remainingVolumeUnit: availableVolumeUnit,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return true;
  });
  } catch (error) {
    if (error instanceof Error && ["reconciliation_would_restore_consumed_volume", "reconciliation_original_volume_required_after_usage"].includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  if (!result) return NextResponse.json({ error: "specimen_volume_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", remainingVolume: availableVolume, remainingVolumeUnit: availableVolumeUnit });
}
