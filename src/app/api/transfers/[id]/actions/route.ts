import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    action?: "DISPATCH" | "RECEIVE_ITEM" | "REPORT_EXCEPTION";
    barcode?: string;
    exceptionType?: string;
    exceptionText?: string;
  } | null;

  if (body?.action !== "DISPATCH" && body?.action !== "RECEIVE_ITEM" && body?.action !== "REPORT_EXCEPTION") return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const permission = body.action === "DISPATCH" ? "transfers.dispatch" : "transfers.receive";
  const session = await requirePermission(permission);
  const ctx = await requestContext();

  const manifest = await prisma.specimenTransferManifest.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      items: { include: { specimen: true } },
      sourceBranch: true,
      destinationBranch: true,
    },
  });
  if (!manifest) return NextResponse.json({ error: "manifest_not_found" }, { status: 404 });

  if (body.action === "DISPATCH") {
    if (!canAccessBranch(session, manifest.sourceBranchId)) return NextResponse.json({ error: "source_branch_forbidden" }, { status: 403 });
    if (manifest.status !== "DRAFT") return NextResponse.json({ error: "manifest_not_dispatchable", status: manifest.status }, { status: 409 });
    if (manifest.items.length === 0) return NextResponse.json({ error: "manifest_empty" }, { status: 409 });

    const invalid = manifest.items.filter((item) =>
      item.specimen.currentBranchId !== manifest.sourceBranchId ||
      !["COLLECTED","RECEIVED"].includes(item.specimen.status)
    );
    if (invalid.length) {
      return NextResponse.json({
        error: "manifest_contains_non_transferable_specimens",
        barcodes: invalid.map((item) => item.barcodeSnapshot),
      }, { status: 409 });
    }

    const dispatched = await prisma.$transaction(async (tx) => {
      const dispatchedAt = new Date();

      const claimedManifest = await tx.specimenTransferManifest.updateMany({
        where: { id: manifest.id, status: "DRAFT" },
        data: {
          status: "DISPATCHED",
          dispatchedByUserId: session.user.id,
          dispatchedAt,
        },
      });
      if (claimedManifest.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");

      const dispatchedItems = await tx.specimenTransferItem.updateMany({
        where: { manifestId: manifest.id, status: "PLANNED" },
        data: { status: "DISPATCHED" },
      });
      if (dispatchedItems.count !== manifest.items.length) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");

      for (const item of manifest.items) {
        const moved = await tx.specimen.updateMany({
          where: {
            id: item.specimenId,
            status: item.specimen.status,
            currentBranchId: manifest.sourceBranchId,
            preanalyticalVersion: item.specimen.preanalyticalVersion,
          },
          data: {
            status: "IN_TRANSIT",
            storageLocation: null,
            storageLocationId: null,
            preanalyticalVersion: { increment: 1 },
          },
        });
        if (moved.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
        await tx.specimenEvent.create({
          data: {
            specimenId: item.specimenId,
            eventType: "TRANSFERRED",
            branchId: manifest.sourceBranchId,
            actorUserId: session.user.id,
            fromStatus: item.specimen.status,
            toStatus: "IN_TRANSIT",
            details: {
              manifestId: manifest.id,
              manifestNumber: manifest.manifestNumber,
              sourceBranchId: manifest.sourceBranchId,
              destinationBranchId: manifest.destinationBranchId,
              priorStorageLocation: item.specimen.storageLocation,
              priorStorageLocationId: item.specimen.storageLocationId,
            },
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: manifest.sourceBranchId,
          actorUserId: session.user.id,
          action: "TRANSFER_MANIFEST_DISPATCHED",
          entityType: "SpecimenTransferManifest",
          entityId: manifest.id,
          oldValues: { status: "DRAFT" },
          newValues: {
            status: "DISPATCHED",
            manifestNumber: manifest.manifestNumber,
            destinationBranchId: manifest.destinationBranchId,
            specimenCount: manifest.items.length,
            dispatchedAt,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return true;
    }, { timeout: 30000 }).catch(error => {
      if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED") return null;
      throw error;
    });

    if (!dispatched) {
      return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
    }
    return NextResponse.json({ status: "ok", manifestStatus: "DISPATCHED" });
  }

  if (!canAccessBranch(session, manifest.destinationBranchId)) {
    return NextResponse.json({ error: "destination_branch_forbidden" }, { status: 403 });
  }
  if (!["DISPATCHED","PARTIALLY_RECEIVED"].includes(manifest.status)) {
    return NextResponse.json({ error: "manifest_not_receivable", status: manifest.status }, { status: 409 });
  }

  const barcode = text(body.barcode, 80);
  if (!barcode) return NextResponse.json({ error: "barcode_required" }, { status: 400 });

  const item = manifest.items.find((entry) => entry.barcodeSnapshot === barcode);
  if (!item) return NextResponse.json({ error: "barcode_not_in_manifest" }, { status: 404 });
  if (item.status === "RECEIVED") return NextResponse.json({ error: "item_already_received" }, { status: 409 });
  if (item.status !== "DISPATCHED") return NextResponse.json({ error: "transfer_item_not_dispatched" }, { status: 409 });
  if (item.specimen.status !== "IN_TRANSIT") {
    return NextResponse.json({ error: "specimen_not_in_transit", status: item.specimen.status }, { status: 409 });
  }

  if (body.action === "REPORT_EXCEPTION") {
    const exceptionType = text(body.exceptionType, 40).toUpperCase();
    const exceptionText = text(body.exceptionText, 400);
    if (!["MISSING", "DAMAGED", "LABEL_MISMATCH", "TEMPERATURE_FAILURE", "OTHER"].includes(exceptionType) || !exceptionText) {
      return NextResponse.json({ error: "transfer_exception_type_and_reason_required" }, { status: 400 });
    }
    const notedAt = new Date();
    const reasonSnapshot = `${exceptionType}: ${exceptionText}`.slice(0, 500);
    const recorded = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM specimen_transfer_manifests
        WHERE id = ${manifest.id} AND organization_id = ${session.user.organizationId}
        FOR UPDATE
      `;
      if (locked.length !== 1 || !["DISPATCHED", "PARTIALLY_RECEIVED"].includes(locked[0].status)) {
        throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
      }
      const claim = await tx.specimenTransferItem.updateMany({
        where: { manifestId: manifest.id, specimenId: item.specimenId, status: "DISPATCHED" },
        data: { status: "EXCEPTION", exceptionText: reasonSnapshot },
      });
      if (claim.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
      if (exceptionType === "MISSING") {
        const stillInTransit = await tx.specimen.count({
          where: {
            id: item.specimenId,
            organizationId: session.user.organizationId,
            currentBranchId: manifest.sourceBranchId,
            status: "IN_TRANSIT",
            preanalyticalVersion: item.specimen.preanalyticalVersion,
          },
        });
        if (stillInTransit !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
      } else {
        // Material physically received with a discrepancy remains quarantined,
        // never accepted for analysis or automatic result release.
        const held = await tx.specimen.updateMany({
          where: {
            id: item.specimenId,
            organizationId: session.user.organizationId,
            status: "IN_TRANSIT",
            currentBranchId: manifest.sourceBranchId,
            preanalyticalVersion: item.specimen.preanalyticalVersion,
          },
          data: {
            status: "QUARANTINED",
            currentBranchId: manifest.destinationBranchId,
            storageLocation: null,
            storageLocationId: null,
            preanalyticalVersion: { increment: 1 },
          },
        });
        if (held.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
      }
      await tx.specimenEvent.create({
        data: {
          specimenId: item.specimenId,
          eventType: exceptionType === "MISSING" ? "TRANSFERRED" : "QUARANTINED",
          branchId: manifest.destinationBranchId,
          actorUserId: session.user.id,
          fromStatus: "IN_TRANSIT",
          toStatus: exceptionType === "MISSING" ? "IN_TRANSIT" : "QUARANTINED",
          details: {
            manifestId: manifest.id,
            barcode,
            receiptException: true,
            exceptionType,
            exceptionText,
            notedAt,
            sourceBranchId: manifest.sourceBranchId,
            destinationBranchId: manifest.destinationBranchId,
            physicalCustodyAccepted: exceptionType !== "MISSING",
          },
        },
      });
      await tx.specimenTransferManifest.update({
        where: { id: manifest.id },
        data: { status: "PARTIALLY_RECEIVED" },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: manifest.destinationBranchId,
          actorUserId: session.user.id,
          action: "TRANSFER_SPECIMEN_RECEIPT_EXCEPTION",
          entityType: "SpecimenTransferManifest",
          entityId: manifest.id,
          reason: reasonSnapshot,
          newValues: {
            barcode,
            specimenId: item.specimenId,
            manifestNumber: manifest.manifestNumber,
            itemStatus: "EXCEPTION",
            specimenStatus: exceptionType === "MISSING" ? "IN_TRANSIT" : "QUARANTINED",
            exceptionType,
            physicalCustodyAccepted: exceptionType !== "MISSING",
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return true;
    }, { timeout: 30000 }).catch(error => {
      if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED") return false;
      throw error;
    });
    if (!recorded) return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
    return NextResponse.json({ status: "ok", barcode, itemStatus: "EXCEPTION", exceptionType });
  }

  const receivedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Serialize receipts on the manifest, including receipts of different
    // barcodes. Otherwise two operators can both write PARTIALLY_RECEIVED.
    const lockedManifest = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM specimen_transfer_manifests
      WHERE id = ${manifest.id} AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (lockedManifest.length !== 1 || !["DISPATCHED", "PARTIALLY_RECEIVED"].includes(lockedManifest[0].status)) {
      throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
    }
    const claimed = await tx.specimenTransferItem.updateMany({
      where: {
        manifestId: manifest.id,
        specimenId: item.specimenId,
        status: "DISPATCHED",
      },
      data: {
        status: "RECEIVED",
        receivedByUserId: session.user.id,
        receivedAt,
      },
    });
    if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");

    const moved = await tx.specimen.updateMany({
      where: {
        id: item.specimenId,
        organizationId: session.user.organizationId,
        status: "IN_TRANSIT",
        currentBranchId: manifest.sourceBranchId,
        preanalyticalVersion: item.specimen.preanalyticalVersion,
      },
      data: {
        status: "RECEIVED",
        currentBranchId: manifest.destinationBranchId,
        storageLocation: null,
        storageLocationId: null,
        receivedByUserId: session.user.id,
        receivedAt,
        preanalyticalVersion: { increment: 1 },
      },
    });
    if (moved.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");

    await tx.specimenEvent.create({
      data: {
        specimenId: item.specimenId,
        eventType: "RECEIVED",
        branchId: manifest.destinationBranchId,
        actorUserId: session.user.id,
        fromStatus: "IN_TRANSIT",
        toStatus: "RECEIVED",
        details: {
          manifestId: manifest.id,
          manifestNumber: manifest.manifestNumber,
          sourceBranchId: manifest.sourceBranchId,
          destinationBranchId: manifest.destinationBranchId,
        },
      },
    });

    const remaining = await tx.specimenTransferItem.count({
      where: { manifestId: manifest.id, status: { not: "RECEIVED" } },
    });
    const manifestStatus = remaining === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED";

    await tx.specimenTransferManifest.update({
      where: { id: manifest.id },
      data: {
        status: manifestStatus,
        ...(remaining === 0 ? {
          receivedByUserId: session.user.id,
          receivedAt,
        } : {}),
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: manifest.destinationBranchId,
        actorUserId: session.user.id,
        action: "TRANSFER_SPECIMEN_RECEIVED",
        entityType: "SpecimenTransferManifest",
        entityId: manifest.id,
        newValues: {
          manifestNumber: manifest.manifestNumber,
          specimenId: item.specimenId,
          barcode,
          destinationBranchId: manifest.destinationBranchId,
          manifestStatus,
          receivedAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { remaining, manifestStatus };
  }).catch(error => {
    if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED") return null;
    throw error;
  });

  if (!result) {
    return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
  }
  return NextResponse.json({
    status: "ok",
    barcode,
    remaining: result.remaining,
    manifestStatus: result.manifestStatus,
  });
}
