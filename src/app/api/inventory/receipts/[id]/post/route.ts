import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("procurement.receive");
  const ctx = await requestContext();
  const { id } = await params;

  const receipt = await prisma.goodsReceipt.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      supplier: true,
      items: { include: { item: true, purchaseOrderItem: true } },
      purchaseOrder: { include: { items: true } },
    },
  });
  if (!receipt) return NextResponse.json({ error: "goods_receipt_not_found" }, { status: 404 });
  if (!canAccessBranch(session, receipt.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (receipt.status !== "DRAFT") return NextResponse.json({ error: "goods_receipt_not_draft", status: receipt.status }, { status: 409 });
  if (receipt.items.length === 0) return NextResponse.json({ error: "goods_receipt_empty" }, { status: 409 });

  try {
    const posted = await prisma.$transaction(async tx => {
      const current = await tx.goodsReceipt.findUnique({ where: { id: receipt.id }, select: { status: true } });
      if (!current || current.status !== "DRAFT") throw new Error("RECEIPT_STATE_CHANGED");

      // A receipt may contain multiple rows for one PO item. Aggregate all
      // quantities before writing any stock to avoid stale receivedQty reuse.
      const increments = new Map<string, Prisma.Decimal>();
      for (const line of receipt.items) {
        if (line.purchaseOrderItemId) {
          increments.set(line.purchaseOrderItemId,
            (increments.get(line.purchaseOrderItemId) || new Prisma.Decimal(0)).add(line.quantity));
        }
      }
      for (const [poItemId, increase] of increments) {
        const currentLine = await tx.purchaseOrderItem.findFirst({
          where: {
            id: poItemId,
            purchaseOrderId: receipt.purchaseOrderId || undefined,
          },
        });
        if (!currentLine || !receipt.purchaseOrderId ||
          currentLine.purchaseOrderId !== receipt.purchaseOrderId ||
          currentLine.receivedQty.add(increase).gt(currentLine.orderedQty)) {
          throw new Error("PO_OVER_RECEIPT");
        }
      }
      for (const line of receipt.items) {
        if (line.quantity.lte(0) || line.unitCost.lt(0)) throw new Error("INVALID_RECEIPT_LINE");
        if (line.item.expiryTracking && !line.expiryDate) throw new Error("EXPIRY_REQUIRED");

        let lot = await tx.inventoryLot.findUnique({
          where: {
            organizationId_itemId_lotNumber: {
              organizationId: session.user.organizationId,
              itemId: line.itemId,
              lotNumber: line.lotNumber,
            },
          },
        });

        if (lot) {
          if (lot.supplierId && lot.supplierId !== receipt.supplierId) throw new Error("LOT_SUPPLIER_CONFLICT");
          if (lot.expiryDate && line.expiryDate && lot.expiryDate.getTime() !== line.expiryDate.getTime()) throw new Error("LOT_EXPIRY_CONFLICT");
          lot = await tx.inventoryLot.update({
            where: { id: lot.id },
            data: {
              supplierId: lot.supplierId || receipt.supplierId,
              receivedDate: lot.receivedDate || receipt.receivedAt,
              expiryDate: lot.expiryDate || line.expiryDate,
              unitCost: line.unitCost,
              currency: line.currency,
            },
          });
        } else {
          lot = await tx.inventoryLot.create({
            data: {
              organizationId: session.user.organizationId,
              itemId: line.itemId,
              supplierId: receipt.supplierId,
              lotNumber: line.lotNumber,
              receivedDate: receipt.receivedAt,
              expiryDate: line.expiryDate,
              unitCost: line.unitCost,
              currency: line.currency,
            },
          });
        }

        const branchStock = await tx.branchStock.upsert({
          where: { branchId_itemId: { branchId: receipt.branchId, itemId: line.itemId } },
          create: { branchId: receipt.branchId, itemId: line.itemId, quantityOnHand: line.quantity },
          update: { quantityOnHand: { increment: line.quantity } },
        });

        await tx.inventoryLotStock.upsert({
          where: { branchId_lotId: { branchId: receipt.branchId, lotId: lot.id } },
          create: { branchId: receipt.branchId, lotId: lot.id, quantityOnHand: line.quantity },
          update: { quantityOnHand: { increment: line.quantity } },
        });

        await tx.goodsReceiptItem.update({ where: { id: line.id }, data: { lotId: lot.id } });

        await tx.stockMovement.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: receipt.branchId,
            itemId: line.itemId,
            lotId: lot.id,
            movementType: "RECEIPT",
            quantity: line.quantity,
            balanceAfter: branchStock.quantityOnHand,
            referenceType: "GoodsReceipt",
            referenceId: receipt.id,
            actorUserId: session.user.id,
          },
        });

        // Purchase-order totals are posted once per item after all rows.

      }

      for (const [poItemId, increase] of increments) {
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: { receivedQty: { increment: increase } },
        });
      }

      if (receipt.purchaseOrderId) {
        const poLines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: receipt.purchaseOrderId } });
        const allReceived = poLines.every(line => line.receivedQty.gte(line.orderedQty));
        const anyReceived = poLines.some(line => line.receivedQty.gt(0));
        await tx.purchaseOrder.update({
          where: { id: receipt.purchaseOrderId },
          data: { status: allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : receipt.purchaseOrder?.status },
        });
      }

      const postedAt = new Date();
      const updated = await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: "POSTED", postedAt },
        include: { items: { include: { item: true, lot: true } } },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: receipt.branchId,
          actorUserId: session.user.id,
          action: "GOODS_RECEIPT_POSTED",
          entityType: "GoodsReceipt",
          entityId: receipt.id,
          oldValues: { status: "DRAFT" },
          newValues: {
            status: "POSTED",
            postedAt,
            items: updated.items.map(line => ({
              itemId: line.itemId,
              lotId: line.lotId,
              lotNumber: line.lotNumber,
              quantity: line.quantity.toString(),
              unitCost: line.unitCost.toString(),
              currency: line.currency,
            })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({ status: "ok", receipt: posted });
  } catch (error) {
    const code = error instanceof Error ? error.message : "POST_FAILED";
    const known = ["RECEIPT_STATE_CHANGED","INVALID_RECEIPT_LINE","EXPIRY_REQUIRED","LOT_SUPPLIER_CONFLICT","LOT_EXPIRY_CONFLICT","PO_OVER_RECEIPT"];
    return NextResponse.json({ error: known.includes(code) ? code.toLowerCase() : "goods_receipt_post_failed" }, { status: 409 });
  }
}
