import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenVolumeUseError } from "@/lib/specimen-volume-policy";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const usageType = ["TESTING","REPEAT_TESTING","SEND_OUT","OTHER"].includes(String(body.usageType))
    ? String(body.usageType) as "TESTING" | "REPEAT_TESTING" | "SEND_OUT" | "OTHER" : null;
  const volumeUsed = typeof body.volumeUsed === "string" || typeof body.volumeUsed === "number" ? String(body.volumeUsed) : "";
  const volumeUnit = text(body.volumeUnit, 30) || null;
  const orderItemId = text(body.orderItemId, 36) || null;
  const notes = text(body.notes, 1000) || null;
  if (!usageType) return NextResponse.json({ error: "invalid_usage_type" }, { status: 400 });
  if (["TESTING","REPEAT_TESTING","SEND_OUT"].includes(usageType) && !orderItemId) {
    return NextResponse.json({ error: "usage_order_item_required" }, { status: 400 });
  }

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { orderItems: true },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (orderItemId && !specimen.orderItems.some(link => link.orderItemId === orderItemId && link.status === "ACTIVE")) {
    return NextResponse.json({ error: "usage_order_item_not_linked" }, { status: 409 });
  }

  const policyError = specimenVolumeUseError({
    status: specimen.status,
    remainingVolume: specimen.remainingVolume?.toFixed(3) || null,
    remainingVolumeUnit: specimen.remainingVolumeUnit,
    requestedVolume: volumeUsed,
    requestedVolumeUnit: volumeUnit,
  });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 409 });

  const result = await prisma.$transaction(async tx => {
    const changed = await tx.specimen.updateMany({
      where: {
        id: specimen.id,
        organizationId: session.user.organizationId,
        status: specimen.status,
        currentBranchId: specimen.currentBranchId,
        remainingVolume: { gte: volumeUsed },
        preanalyticalVersion: specimen.preanalyticalVersion,
      },
      data: {
        remainingVolume: { decrement: volumeUsed },
        preanalyticalVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;

    const updated = await tx.specimen.findUniqueOrThrow({
      where: { id: specimen.id },
      select: { remainingVolume: true, remainingVolumeUnit: true },
    });

    const usage = await tx.specimenUsageEvent.create({
      data: {
        organizationId: specimen.organizationId,
        specimenId: specimen.id,
        orderItemId,
        branchId: specimen.currentBranchId!,
        usageType,
        volumeUsed,
        volumeUnit: specimen.remainingVolumeUnit!,
        notes,
        usedByUserId: session.user.id,
      },
    });

    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "USED",
        branchId: specimen.currentBranchId!,
        actorUserId: session.user.id,
        fromStatus: specimen.status,
        toStatus: specimen.status,
        details: {
          usageEventId: usage.id,
          usageType,
          orderItemId,
          volumeUsed,
          volumeUnit: specimen.remainingVolumeUnit,
          remainingVolumeAfter: updated.remainingVolume?.toFixed(3) || null,
          notes,
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: specimen.organizationId,
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_USAGE_RECORDED",
        entityType: "Specimen",
        entityId: specimen.id,
        newValues: {
          usageEventId: usage.id,
          usageType,
          orderItemId,
          volumeUsed,
          volumeUnit: specimen.remainingVolumeUnit,
          remainingVolume: updated.remainingVolume?.toFixed(3) || null,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return updated;
  });

  if (!result) return NextResponse.json({ error: "specimen_volume_changed" }, { status: 409 });
  return NextResponse.json({
    status: "ok",
    remainingVolume: result.remainingVolume?.toFixed(3) || null,
    remainingVolumeUnit: result.remainingVolumeUnit,
  });
}
