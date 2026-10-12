import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {lockLotsForSafety} from "@/lib/inventory-lot-safety";

function nonNegative(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(raw)) throw new Error("INVALID_DECIMAL");
  return new Prisma.Decimal(raw);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.transfer");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { finalize?: boolean; items?: Array<{ transferItemId?: string; receivedQty?: unknown }> } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const transfer = await prisma.inventoryTransfer.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { items: true },
  });
  if (!transfer) return NextResponse.json({ error: "inventory_transfer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, transfer.destinationBranchId)) return NextResponse.json({ error: "destination_branch_forbidden" }, { status: 403 });
  if (!["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status)) {
    return NextResponse.json({ error: "inventory_transfer_not_receivable", status: transfer.status }, { status: 409 });
  }

  // Reject duplicate or foreign line identifiers before any stock mutation.
  // A Map alone would silently overwrite repeated transfer lines.
  const knownLineIds = new Set(transfer.items.map(line => line.id));
  const submittedIds = body.items.map(line => line.transferItemId);
  if (submittedIds.some(lineId => typeof lineId !== "string" || !knownLineIds.has(lineId))
    || new Set(submittedIds).size !== submittedIds.length) {
    return NextResponse.json({ error: "invalid_or_duplicate_transfer_item" }, { status: 400 });
  }
  const incoming = new Map(body.items.map(line => [line.transferItemId!, line.receivedQty]));
  try {
    const received = await prisma.$transaction(async tx => {
      const current = await tx.inventoryTransfer.findUnique({ where: { id: transfer.id }, select: { status: true } });
      if (!current || !["DISPATCHED","PARTIALLY_RECEIVED"].includes(current.status)) throw new Error("STATE_CHANGED");

      // Read the latest line quantities under the same transaction.
      // A second receiver must never use an older receivedQty snapshot.
      const currentLines = await tx.inventoryTransferItem.findMany({
        where: { transferId: transfer.id },
      });
      // Physical custody of an already shipped recalled lot must still be
      // receivable. Its safety status remains held across every branch.
      const receivedLotStates=await lockLotsForSafety(tx,session.user.organizationId,
        currentLines.filter(line=>incoming.has(line.id)).map(line=>line.lotId));
      if(receivedLotStates.size!==new Set(currentLines.filter(line=>incoming.has(line.id))
        .map(line=>line.lotId)).size)throw new Error("LOT_SAFETY_NOT_FOUND");
      for (const line of currentLines) {
        if (!incoming.has(line.id)) continue;
        const addQty = nonNegative(incoming.get(line.id));
        const dispatchedQty = line.dispatchedQty || new Prisma.Decimal(0);
        const alreadyReceived = line.receivedQty || new Prisma.Decimal(0);
        const nextReceived = alreadyReceived.add(addQty);
        if (nextReceived.gt(dispatchedQty)) throw new Error("RECEIVED_EXCEEDS_DISPATCHED");

        if (addQty.gt(0)) {
          const branchStock = await tx.branchStock.upsert({
            where: { branchId_itemId: { branchId: transfer.destinationBranchId, itemId: line.itemId } },
            create: { branchId: transfer.destinationBranchId, itemId: line.itemId, quantityOnHand: addQty },
            update: { quantityOnHand: { increment: addQty } },
          });
          await tx.inventoryLotStock.upsert({
            where: { branchId_lotId: { branchId: transfer.destinationBranchId, lotId: line.lotId } },
            create: { branchId: transfer.destinationBranchId, lotId: line.lotId, quantityOnHand: addQty },
            update: { quantityOnHand: { increment: addQty } },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: session.user.organizationId,
              branchId: transfer.destinationBranchId,
              itemId: line.itemId,
              lotId: line.lotId,
              movementType: "TRANSFER_IN",
              quantity: addQty,
              balanceAfter: branchStock.quantityOnHand,
              referenceType: "InventoryTransfer",
              referenceId: transfer.id,
              actorUserId: session.user.id,
            },
          });
        }

        await tx.inventoryTransferItem.update({
          where: { id: line.id },
          data: {
            receivedQty: nextReceived,
            discrepancyQty: body.finalize ? dispatchedQty.sub(nextReceived) : line.discrepancyQty,
          },
        });
      }

      const refreshed = await tx.inventoryTransferItem.findMany({ where: { transferId: transfer.id } });
      const allFullyReceived = refreshed.every(line => (line.receivedQty || new Prisma.Decimal(0)).gte(line.dispatchedQty || new Prisma.Decimal(0)));
      const status = allFullyReceived || body.finalize ? "RECEIVED" : "PARTIALLY_RECEIVED";
      const receivedAt = status === "RECEIVED" ? new Date() : null;

      if (body.finalize) {
        for (const line of refreshed) {
          const dispatched = line.dispatchedQty || new Prisma.Decimal(0);
          const receivedQty = line.receivedQty || new Prisma.Decimal(0);
          await tx.inventoryTransferItem.update({
            where: { id: line.id },
            data: { discrepancyQty: dispatched.sub(receivedQty) },
          });
        }
      }

      const updated = await tx.inventoryTransfer.update({
        where: { id: transfer.id },
        data: {
          status,
          receivedByUserId: status === "RECEIVED" ? session.user.id : transfer.receivedByUserId,
          receivedAt: status === "RECEIVED" ? receivedAt : transfer.receivedAt,
        },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: transfer.destinationBranchId,
          actorUserId: session.user.id,
          action: status === "RECEIVED" ? "INVENTORY_TRANSFER_RECEIVED" : "INVENTORY_TRANSFER_PARTIALLY_RECEIVED",
          entityType: "InventoryTransfer",
          entityId: transfer.id,
          oldValues: { status: transfer.status },
          newValues: {
            status,
            receivedAt,
            finalize: body.finalize === true,
            items: updated.items.map(line => ({
              id: line.id,
              dispatchedQty: line.dispatchedQty?.toString() || null,
              receivedQty: line.receivedQty?.toString() || null,
              discrepancyQty: line.discrepancyQty?.toString() || null,
            })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({ status: "ok", transfer: received });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = ["INVALID_DECIMAL","STATE_CHANGED","RECEIVED_EXCEEDS_DISPATCHED"];
    return NextResponse.json({ error: known.includes(code) ? code.toLowerCase() : "inventory_transfer_receive_failed" }, { status: 409 });
  }
}
