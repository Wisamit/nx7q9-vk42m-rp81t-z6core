import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { lockActiveTransferOrders, TransferOrderNoLongerActive } from "@/lib/transfer-order-activity";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
class ManifestStateChanged extends Error {}
function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))];
}
function manifestNumber() {
  const date = new Date().toISOString().slice(0,10).replace(/-/g,"");
  return `TRF-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("transfers.create");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const sourceBranchId = text(body.sourceBranchId, 36) || session.activeBranchId;
  const destinationBranchId = text(body.destinationBranchId, 36);
  const specimenIds = uniqueIds(body.specimenIds);
  const transportMode = text(body.transportMode, 80);
  const courierName = text(body.courierName, 150);
  const notes = text(body.notes, 5000);
  const packageCount = body.packageCount === "" || body.packageCount == null ? null : Number(body.packageCount);

  if (!sourceBranchId || !destinationBranchId || sourceBranchId === destinationBranchId || specimenIds.length === 0) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, sourceBranchId)) return NextResponse.json({ error: "source_branch_forbidden" }, { status: 403 });
  if (packageCount !== null && (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 9999)) {
    return NextResponse.json({ error: "invalid_package_count" }, { status: 400 });
  }

  const destination = await prisma.branch.findFirst({
    where: { id: destinationBranchId, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!destination) return NextResponse.json({ error: "destination_branch_not_found" }, { status: 404 });

  const specimens = await prisma.specimen.findMany({
    where: {
      id: { in: specimenIds },
      organizationId: session.user.organizationId,
      currentBranchId: sourceBranchId,
      status: { in: ["COLLECTED","RECEIVED"] },
    },
    select: { id: true, barcode: true, status: true, orderId: true,
      order: { select: { status: true } } },
  });
  if (specimens.length !== specimenIds.length) {
    return NextResponse.json({ error: "one_or_more_specimens_not_transferable" }, { status: 409 });
  }
  if (specimens.some(specimen => !["REGISTERED", "COLLECTED", "IN_PROGRESS"].includes(specimen.order.status))) {
    return NextResponse.json({ error: "transfer_order_not_active" }, { status: 409 });
  }

  const activeTransfers = await prisma.specimenTransferItem.findMany({
    where: {
      specimenId: { in: specimenIds },
      manifest: { status: { in: ["DRAFT","DISPATCHED","PARTIALLY_RECEIVED"] } },
    },
    select: { specimenId: true, manifest: { select: { manifestNumber: true } } },
  });
  if (activeTransfers.length) {
    return NextResponse.json({ error: "specimen_already_in_active_manifest", conflicts: activeTransfers }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    // Parent order cancellation/completion must serialize with new manifest
    // creation, even when a stale page still lists a transferable specimen.
    await lockActiveTransferOrders(
      tx, session.user.organizationId, specimens.map(specimen => specimen.orderId),
    );
    // Serialize manifest creation per specimen to prevent concurrent DRAFT
    // manifests for the same specimen. Stable lock ordering avoids deadlocks.
    for (const specimenId of [...specimenIds].sort()) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM specimens
        WHERE id = ${specimenId}
          AND organization_id = ${session.user.organizationId}
          AND current_branch_id = ${sourceBranchId}
          AND status IN ('COLLECTED', 'RECEIVED')
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new ManifestStateChanged();
    }
    const concurrentTransfers = await tx.specimenTransferItem.count({
      where: {
        specimenId: { in: specimenIds },
        manifest: { status: { in: ["DRAFT", "DISPATCHED", "PARTIALLY_RECEIVED"] } },
      },
    });
    if (concurrentTransfers !== 0) throw new ManifestStateChanged();

    let number = manifestNumber();
    while (await tx.specimenTransferManifest.findUnique({
      where: { organizationId_manifestNumber: { organizationId: session.user.organizationId, manifestNumber: number } },
    })) number = manifestNumber();

    const manifest = await tx.specimenTransferManifest.create({
      data: {
        organizationId: session.user.organizationId,
        manifestNumber: number,
        sourceBranchId,
        destinationBranchId,
        transportMode: transportMode || null,
        courierName: courierName || null,
        packageCount,
        notes: notes || null,
        createdByUserId: session.user.id,
      },
    });

    await tx.specimenTransferItem.createMany({
      data: specimens.map((specimen) => ({
        manifestId: manifest.id,
        specimenId: specimen.id,
        barcodeSnapshot: specimen.barcode,
      })),
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: sourceBranchId,
        actorUserId: session.user.id,
        action: "TRANSFER_MANIFEST_CREATED",
        entityType: "SpecimenTransferManifest",
        entityId: manifest.id,
        newValues: {
          manifestNumber: number,
          sourceBranchId,
          destinationBranchId,
          specimenIds,
          transportMode: transportMode || null,
          courierName: courierName || null,
          packageCount,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return manifest;
  }).catch(error => {
    if (error instanceof TransferOrderNoLongerActive) return "ORDER_CLOSED" as const;
    if (error instanceof ManifestStateChanged) return null;
    throw error;
  });

  if (created === "ORDER_CLOSED") {
    return NextResponse.json({ error: "transfer_order_not_active" }, { status: 409 });
  }
  if (!created) return NextResponse.json({ error: "specimen_already_in_active_manifest_or_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", manifest: created }, { status: 201 });
}
