import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  aliquotPurposeRequiresTests,
  minorToVolume3,
  specimenVolumeUseError,
  volume3ToMinor,
} from "@/lib/specimen-volume-policy";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class SpecimenVolumeChanged extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const volume = typeof body.volume === "string" || typeof body.volume === "number" ? String(body.volume) : "";
  const volumeUnit = text(body.volumeUnit, 30) || null;
  const containerId = text(body.containerId, 36) || null;
  const storageLocation = text(body.storageLocation, 200) || null;
  const notes = text(body.notes, 1000) || null;
  const purpose = ["TESTING","STORAGE","SEND_OUT","OTHER"].includes(String(body.purpose)) ? String(body.purpose) : "";
  const requestedOrderItemIds = Array.isArray(body.orderItemIds)
    ? [...new Set(body.orderItemIds.filter((item): item is string => typeof item === "string" && item.length <= 36))]
    : [];

  if (!purpose) return NextResponse.json({ error: "invalid_aliquot_purpose" }, { status: 400 });
  if (aliquotPurposeRequiresTests(purpose) && requestedOrderItemIds.length === 0) {
    return NextResponse.json({ error: "aliquot_tests_required" }, { status: 400 });
  }

  const parent = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      order: true,
      orderItems: { include: { orderItem: true } },
    },
  });
  if (!parent) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!parent.currentBranchId || !canAccessBranch(session, parent.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const volumeError = specimenVolumeUseError({
    status: parent.status,
    remainingVolume: parent.remainingVolume?.toFixed(3) || null,
    remainingVolumeUnit: parent.remainingVolumeUnit,
    requestedVolume: volume,
    requestedVolumeUnit: volumeUnit,
  });
  if (volumeError) return NextResponse.json({ error: volumeError }, { status: 409 });

  const linkedIds = new Set(parent.orderItems.filter(link => link.orderItem.status !== "CANCELLED").map(link => link.orderItemId));
  if (requestedOrderItemIds.some(orderItemId => !linkedIds.has(orderItemId))) {
    return NextResponse.json({ error: "aliquot_order_item_not_linked_to_parent" }, { status: 409 });
  }

  if (containerId) {
    const container = await prisma.container.findFirst({
      where: { id: containerId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!container) return NextResponse.json({ error: "container_not_found" }, { status: 404 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async tx => {
        const consumed = await tx.specimen.updateMany({
          where: {
            id: parent.id,
            organizationId: session.user.organizationId,
            status: parent.status,
            currentBranchId: parent.currentBranchId,
            remainingVolume: { gte: volume },
          },
          data: { remainingVolume: { decrement: volume } },
        });
        if (consumed.count !== 1) throw new SpecimenVolumeChanged();

        const updatedParent = await tx.specimen.findUniqueOrThrow({
          where: { id: parent.id },
          select: { remainingVolume: true, remainingVolumeUnit: true },
        });

        const remainingAfter = updatedParent.remainingVolume?.toFixed(3) || null;
        const afterMinor = volume3ToMinor(remainingAfter);
        const usedMinor = volume3ToMinor(volume);
        const actualBefore = afterMinor !== null && usedMinor !== null ? minorToVolume3(afterMinor + usedMinor) : null;

        const maxSequence = await tx.specimen.aggregate({
          where: { orderId: parent.orderId },
          _max: { sequenceNumber: true },
        });
        const sequenceNumber = (maxSequence._max.sequenceNumber || 0) + 1;
        const barcode = `${parent.order.accessionNumber}-${String(sequenceNumber).padStart(2, "0")}`;
        const childStatus = parent.status === "IN_PROCESS" ? "RECEIVED" : parent.status;
        const derivedAt = new Date();

        const child = await tx.specimen.create({
          data: {
            organizationId: parent.organizationId,
            orderId: parent.orderId,
            parentSpecimenId: parent.id,
            parentRelationType: "ALIQUOT",
            specimenTypeId: parent.specimenTypeId,
            containerId: containerId || parent.containerId,
            barcode,
            sequenceNumber,
            status: childStatus,
            collectionBranchId: parent.collectionBranchId,
            currentBranchId: parent.currentBranchId,
            receivedByUserId: ["RECEIVED","IN_PROCESS"].includes(childStatus) ? session.user.id : null,
            receivedAt: ["RECEIVED","IN_PROCESS"].includes(childStatus) ? derivedAt : null,
            volume,
            volumeUnit: parent.remainingVolumeUnit,
            remainingVolume: volume,
            remainingVolumeUnit: parent.remainingVolumeUnit,
            storageLocation,
            notes,
          },
        });

        if (requestedOrderItemIds.length) {
          await tx.specimenOrderItem.createMany({
            data: requestedOrderItemIds.map(orderItemId => ({ specimenId: child.id, orderItemId })),
          });
        }

        await tx.specimenEvent.create({
          data: {
            specimenId: child.id,
            eventType: "CREATED",
            branchId: parent.currentBranchId,
            actorUserId: session.user.id,
            fromStatus: null,
            toStatus: childStatus,
            details: {
              derivedAliquot: true,
              parentSpecimenId: parent.id,
              parentBarcode: parent.barcode,
              allocatedVolume: volume,
              volumeUnit: parent.remainingVolumeUnit,
              purpose,
              storageLocation,
              linkedOrderItemIds: requestedOrderItemIds,
            },
          },
        });

        await tx.specimenEvent.create({
          data: {
            specimenId: parent.id,
            eventType: "ALIQUOT_CREATED",
            branchId: parent.currentBranchId,
            actorUserId: session.user.id,
            fromStatus: parent.status,
            toStatus: parent.status,
            details: {
              childSpecimenId: child.id,
              childBarcode: child.barcode,
              allocatedVolume: volume,
              volumeUnit: parent.remainingVolumeUnit,
              remainingVolumeBefore: actualBefore,
              remainingVolumeAfter: remainingAfter,
              purpose,
            },
          },
        });

        await tx.specimenUsageEvent.create({
          data: {
            organizationId: parent.organizationId,
            specimenId: parent.id,
            childSpecimenId: child.id,
            branchId: parent.currentBranchId,
            usageType: "ALIQUOT",
            volumeUsed: volume,
            volumeUnit: parent.remainingVolumeUnit!,
            notes: [purpose, notes].filter(Boolean).join(" · ").slice(0, 1000) || null,
            usedByUserId: session.user.id,
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: parent.organizationId,
            branchId: parent.currentBranchId,
            actorUserId: session.user.id,
            action: "SPECIMEN_ALIQUOT_CREATED",
            entityType: "Specimen",
            entityId: child.id,
            newValues: {
              parentSpecimenId: parent.id,
              parentBarcode: parent.barcode,
              childBarcode: child.barcode,
              purpose,
              volume,
              volumeUnit: parent.remainingVolumeUnit,
              parentRemainingVolume: remainingAfter,
              storageLocation,
              linkedOrderItemIds: requestedOrderItemIds,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });

        return {
          child,
          remainingVolume: remainingAfter,
          remainingVolumeUnit: updatedParent.remainingVolumeUnit,
        };
      }, { timeout: 30000 });

      return NextResponse.json({
        status: "ok",
        aliquotId: result.child.id,
        barcode: result.child.barcode,
        parentRemainingVolume: result.remainingVolume,
        parentRemainingVolumeUnit: result.remainingVolumeUnit,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof SpecimenVolumeChanged) {
        return NextResponse.json({ error: "specimen_volume_changed" }, { status: 409 });
      }
      if (error && typeof error === "object" && "code" in error && error.code === "P2002" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "aliquot_sequence_conflict" }, { status: 409 });
}
