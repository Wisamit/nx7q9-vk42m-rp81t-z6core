import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function cleanText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function parsePositiveVolume(value: unknown) {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return !Number.isFinite(numeric) || numeric <= 0 ? Number.NaN : numeric;
}
function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim()).map(item => item.trim()))];
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.aliquot");
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    volume?: unknown; volumeUnit?: unknown; storageLocation?: unknown; notes?: unknown; orderItemIds?: unknown;
  } | null;

  const parent = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      order: true,
      orderItems: { include: { orderItem: true } },
      usageEvents: { select: { volumeUsed: true, volumeUnit: true } },
    },
  });
  if (!parent) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!parent.currentBranchId || !canAccessBranch(session, parent.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!["RECEIVED", "IN_PROCESS"].includes(parent.status)) {
    return NextResponse.json({ error: "specimen_not_ready_for_aliquot", status: parent.status }, { status: 409 });
  }

  const volume = parsePositiveVolume(body?.volume);
  if (volume === null || Number.isNaN(volume)) {
    return NextResponse.json({ error: "positive_aliquot_volume_required" }, { status: 400 });
  }
  const requestedUnit = cleanText(body?.volumeUnit, 30);
  const volumeUnit = parent.volumeUnit || requestedUnit;
  if (!volumeUnit) return NextResponse.json({ error: "volume_unit_required" }, { status: 400 });
  if (parent.volumeUnit && requestedUnit && requestedUnit !== parent.volumeUnit) {
    return NextResponse.json({ error: "volume_unit_mismatch", expected: parent.volumeUnit }, { status: 400 });
  }

  const usedSameUnit = parent.usageEvents.reduce((sum, event) => {
    if (!event.volumeUsed || event.volumeUnit !== volumeUnit) return sum;
    return sum + event.volumeUsed.toNumber();
  }, 0);
  const parentVolume = parent.volume?.toNumber() ?? null;
  if (parentVolume !== null && volumeUnit === parent.volumeUnit) {
    const remaining = Math.max(0, parentVolume - usedSameUnit);
    if (volume > remaining + 0.0005) {
      return NextResponse.json({ error: "insufficient_remaining_volume", remaining, volumeUnit }, { status: 409 });
    }
  }

  const linkedParentItemIds = new Set(parent.orderItems.map(link => link.orderItemId));
  const requestedItemIds = uniqueIds(body?.orderItemIds);
  const selectedItemIds = requestedItemIds.length ? requestedItemIds : [...linkedParentItemIds];
  if (!selectedItemIds.length || selectedItemIds.some(orderItemId => !linkedParentItemIds.has(orderItemId))) {
    return NextResponse.json({ error: "invalid_aliquot_order_items" }, { status: 400 });
  }

  const storageLocation = cleanText(body?.storageLocation, 255) || null;
  const notes = cleanText(body?.notes, 5000) || null;
  const ctx = await requestContext();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        const aggregate = await tx.specimen.aggregate({
          where: { orderId: parent.orderId },
          _max: { sequenceNumber: true },
        });
        const sequenceNumber = (aggregate._max.sequenceNumber || 0) + 1;
        const barcode = `${parent.order.accessionNumber}-AQ-${randomBytes(3).toString("hex").toUpperCase()}`;

        const aliquot = await tx.specimen.create({
          data: {
            organizationId: parent.organizationId,
            orderId: parent.orderId,
            parentSpecimenId: parent.id,
            specimenTypeId: parent.specimenTypeId,
            containerId: parent.containerId,
            barcode,
            sequenceNumber,
            kind: "ALIQUOT",
            status: "RECEIVED",
            collectionBranchId: parent.collectionBranchId,
            currentBranchId: parent.currentBranchId,
            collectedByUserId: parent.collectedByUserId,
            collectedAt: parent.collectedAt,
            receivedByUserId: session.user.id,
            receivedAt: new Date(),
            volume: volume.toFixed(3),
            volumeUnit,
            storageLocation,
            notes,
          },
        });
        await tx.specimenOrderItem.createMany({
          data: selectedItemIds.map(orderItemId => ({ specimenId: aliquot.id, orderItemId })),
        });
        await tx.specimenUsageEvent.create({
          data: {
            organizationId: parent.organizationId,
            specimenId: parent.id,
            branchId: parent.currentBranchId!,
            usedByUserId: session.user.id,
            usageType: "TRANSFER",
            volumeUsed: volume.toFixed(3),
            volumeUnit,
            purpose: `Aliquot created: ${barcode}`,
          },
        });
        await tx.specimenEvent.createMany({
          data: [
            {
              specimenId: parent.id,
              eventType: "USAGE_RECORDED",
              branchId: parent.currentBranchId,
              actorUserId: session.user.id,
              fromStatus: parent.status,
              toStatus: parent.status,
              details: { usageType: "TRANSFER", volumeUsed: volume.toFixed(3), volumeUnit, childAliquotId: aliquot.id, childBarcode: barcode },
            },
            {
              specimenId: aliquot.id,
              eventType: "ALIQUOT_CREATED",
              branchId: parent.currentBranchId,
              actorUserId: session.user.id,
              fromStatus: null,
              toStatus: "RECEIVED",
              details: { parentSpecimenId: parent.id, parentBarcode: parent.barcode, volume: volume.toFixed(3), volumeUnit, storageLocation, orderItemIds: selectedItemIds },
            },
          ],
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: parent.currentBranchId,
            actorUserId: session.user.id,
            action: "SPECIMEN_ALIQUOT_CREATED",
            entityType: "Specimen",
            entityId: aliquot.id,
            newValues: { parentSpecimenId: parent.id, parentBarcode: parent.barcode, barcode, volume: volume.toFixed(3), volumeUnit, storageLocation, orderItemIds: selectedItemIds },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        return aliquot;
      }, { timeout: 30000 });
      return NextResponse.json({ status: "ok", aliquot: result });
    } catch (error) {
      const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!duplicate || attempt === 2) throw error;
    }
  }
  return NextResponse.json({ error: "aliquot_creation_failed" }, { status: 500 });
}
