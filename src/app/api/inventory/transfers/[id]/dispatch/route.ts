import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {lockLotsForSafety,assertLotUsable} from "@/lib/inventory-lot-safety";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.transfer");
  const ctx = await requestContext();
  const { id } = await params;
  const transfer = await prisma.inventoryTransfer.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { items: true },
  });
  if (!transfer) return NextResponse.json({ error: "inventory_transfer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, transfer.sourceBranchId)) return NextResponse.json({ error: "source_branch_forbidden" }, { status: 403 });
  if (transfer.status !== "APPROVED") return NextResponse.json({ error: "inventory_transfer_not_dispatchable", status: transfer.status }, { status: 409 });

  try {
    const dispatched = await prisma.$transaction(async tx => {
      const current = await tx.inventoryTransfer.findUnique({ where: { id: transfer.id }, select: { status: true } });
      if (!current || current.status !== "APPROVED") throw new Error("STATE_CHANGED");

      const safeLots=await lockLotsForSafety(tx,session.user.organizationId,
        transfer.items.map(line=>line.lotId));
      for(const line of transfer.items)assertLotUsable(safeLots,line.lotId);
      for (const line of transfer.items) {
        const qty = line.approvedQty;
        if (!qty || qty.lte(0)) throw new Error("APPROVED_QTY_MISSING");
        const [lotStock, branchStock] = await Promise.all([
          tx.inventoryLotStock.findUnique({ where: { branchId_lotId: { branchId: transfer.sourceBranchId, lotId: line.lotId } } }),
          tx.branchStock.findUnique({ where: { branchId_itemId: { branchId: transfer.sourceBranchId, itemId: line.itemId } } }),
        ]);
        if (!lotStock || !branchStock || lotStock.quantityOnHand.lt(qty) || lotStock.reservedQty.lt(qty) || branchStock.quantityOnHand.lt(qty) || branchStock.reservedQty.lt(qty)) {
          throw new Error("RESERVED_STOCK_INVALID");
        }

        const nextBranchQty = branchStock.quantityOnHand.sub(qty);
        await tx.inventoryLotStock.update({
          where: { id: lotStock.id },
          data: { quantityOnHand: { decrement: qty }, reservedQty: { decrement: qty } },
        });
        await tx.branchStock.update({
          where: { id: branchStock.id },
          data: { quantityOnHand: { decrement: qty }, reservedQty: { decrement: qty } },
        });
        await tx.inventoryTransferItem.update({ where: { id: line.id }, data: { dispatchedQty: qty } });
        await tx.stockMovement.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: transfer.sourceBranchId,
            itemId: line.itemId,
            lotId: line.lotId,
            movementType: "TRANSFER_OUT",
            quantity: qty.negated(),
            balanceAfter: nextBranchQty,
            referenceType: "InventoryTransfer",
            referenceId: transfer.id,
            actorUserId: session.user.id,
          },
        });
      }

      const dispatchedAt = new Date();
      const updated = await tx.inventoryTransfer.update({
        where: { id: transfer.id },
        data: { status: "DISPATCHED", dispatchedByUserId: session.user.id, dispatchedAt },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: transfer.sourceBranchId,
          actorUserId: session.user.id,
          action: "INVENTORY_TRANSFER_DISPATCHED",
          entityType: "InventoryTransfer",
          entityId: transfer.id,
          oldValues: { status: "APPROVED" },
          newValues: { status: "DISPATCHED", dispatchedAt },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({ status: "ok", transfer: dispatched });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: ["STATE_CHANGED","APPROVED_QTY_MISSING","RESERVED_STOCK_INVALID"].includes(code) ? code.toLowerCase() : "inventory_transfer_dispatch_failed" }, { status: 409 });
  }
}
