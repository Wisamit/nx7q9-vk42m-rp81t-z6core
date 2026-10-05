import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    action?: "DISPATCH" | "RECEIVE_ITEM";
    barcode?: string;
  } | null;

  if (!body?.action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

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

    await prisma.$transaction(async (tx) => {
      const dispatchedAt = new Date();

      await tx.specimenTransferManifest.update({
        where: { id: manifest.id },
        data: {
          status: "DISPATCHED",
          dispatchedByUserId: session.user.id,
          dispatchedAt,
        },
      });

      await tx.specimenTransferItem.updateMany({
        where: { manifestId: manifest.id, status: "PLANNED" },
        data: { status: "DISPATCHED" },
      });

      for (const item of manifest.items) {
        await tx.specimen.update({
          where: { id: item.specimenId },
          data: { status: "IN_TRANSIT" },
        });
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
    }, { timeout: 30000 });

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
  if (item.specimen.status !== "IN_TRANSIT") {
    return NextResponse.json({ error: "specimen_not_in_transit", status: item.specimen.status }, { status: 409 });
  }

  const receivedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.specimenTransferItem.update({
      where: { manifestId_specimenId: { manifestId: manifest.id, specimenId: item.specimenId } },
      data: {
        status: "RECEIVED",
        receivedByUserId: session.user.id,
        receivedAt,
      },
    });

    await tx.specimen.update({
      where: { id: item.specimenId },
      data: {
        status: "RECEIVED",
        currentBranchId: manifest.destinationBranchId,
        receivedByUserId: session.user.id,
        receivedAt,
      },
    });

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
  });

  return NextResponse.json({
    status: "ok",
    barcode,
    remaining: result.remaining,
    manifestStatus: result.manifestStatus,
  });
}
