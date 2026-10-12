import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {lockLotsForSafety,assertLotUsable} from "@/lib/inventory-lot-safety";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function positive(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(raw)) throw new Error("INVALID_DECIMAL");
  const number = new Prisma.Decimal(raw);
  if (number.lte(0)) throw new Error("INVALID_DECIMAL");
  return number;
}

export async function POST(request: Request) {
  const session = await requirePermission("inventory.consume");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    branchId?: unknown; itemId?: unknown; lotId?: unknown; quantity?: unknown;
    referenceType?: unknown; referenceId?: unknown; reason?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const itemId = text(body.itemId, 36);
  const requestedLotId = text(body.lotId, 36) || null;
  const referenceType = text(body.referenceType, 80) || null;
  const referenceId = text(body.referenceId, 36) || null;
  const reason = text(body.reason, 500) || null;
  if (!branchId || !itemId) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  let quantity: Prisma.Decimal;
  try { quantity = positive(body.quantity); }
  catch { return NextResponse.json({ error: "invalid_quantity" }, { status: 400 }); }

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (!item) return NextResponse.json({ error: "inventory_item_not_found" }, { status: 404 });

  try {
    const result = await prisma.$transaction(async tx => {
      const branchStock = await tx.branchStock.findUnique({ where: { branchId_itemId: { branchId, itemId } } });
      if (!branchStock || branchStock.quantityOnHand.sub(branchStock.reservedQty).lt(quantity)) {
        throw new Error("INSUFFICIENT_AVAILABLE_STOCK");
      }

      const lotStocks = await tx.inventoryLotStock.findMany({
        where: {
          branchId,
          quantityOnHand: { gt: 0 },
          lot: {
            organizationId: session.user.organizationId,
            itemId,
            status: "ACTIVE",
            ...(requestedLotId ? { id: requestedLotId } : {}),
          },
        },
        include: { lot: true },
      });

      // Lock every candidate lot before FEFO allocation. A concurrent recall
      // cannot commit between eligibility evaluation and stock mutation.
      const lockedLots=await lockLotsForSafety(tx,session.user.organizationId,
        lotStocks.map(stock=>stock.lotId));
      if(requestedLotId&&lotStocks.length===0)
        throw new Error("REQUESTED_LOT_INSUFFICIENT_OR_EXPIRED");
      const availableLots=lotStocks.filter(stock=>{
        const row=lockedLots.get(stock.lotId);
        if(!row||row.status!=="ACTIVE"||row.safety_status!=="AVAILABLE")return false;
        assertLotUsable(lockedLots,stock.lotId);
        return true;
      });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const eligible = availableLots
        .filter(stock => {
          if (stock.quantityOnHand.sub(stock.reservedQty).lte(0)) return false;
          if (stock.lot.expiryDate && stock.lot.expiryDate < today) return false;
          return true;
        })
        .sort((a, b) => {
          const aExpiry = a.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bExpiry = b.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          if (aExpiry !== bExpiry) return aExpiry - bExpiry;
          const aReceived = a.lot.receivedDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bReceived = b.lot.receivedDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return aReceived - bReceived;
        });

      let remaining = quantity;
      const allocations: Array<{ lotId: string; lotNumber: string; quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal }> = [];
      let currentBranchBalance = branchStock.quantityOnHand;

      for (const stock of eligible) {
        if (remaining.lte(0)) break;
        const available = stock.quantityOnHand.sub(stock.reservedQty);
        const take = Prisma.Decimal.min(available, remaining);
        if (take.lte(0)) continue;

        currentBranchBalance = currentBranchBalance.sub(take);
        await tx.inventoryLotStock.update({ where: { id: stock.id }, data: { quantityOnHand: { decrement: take } } });
        await tx.branchStock.update({ where: { id: branchStock.id }, data: { quantityOnHand: { decrement: take } } });
        await tx.stockMovement.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            itemId,
            lotId: stock.lotId,
            movementType: "CONSUMPTION",
            quantity: take.negated(),
            balanceAfter: currentBranchBalance,
            referenceType,
            referenceId,
            reason,
            actorUserId: session.user.id,
          },
        });
        allocations.push({ lotId: stock.lotId, lotNumber: stock.lot.lotNumber, quantity: take, balanceAfter: currentBranchBalance });
        remaining = remaining.sub(take);
      }

      if (remaining.gt(0)) throw new Error(requestedLotId ? "REQUESTED_LOT_INSUFFICIENT_OR_EXPIRED" : "FEFO_STOCK_INSUFFICIENT");

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "INVENTORY_CONSUMED",
          entityType: "InventoryItem",
          entityId: itemId,
          newValues: {
            requestedQuantity: quantity.toString(),
            requestedLotId,
            referenceType,
            referenceId,
            allocations: allocations.map(allocation => ({
              lotId: allocation.lotId,
              lotNumber: allocation.lotNumber,
              quantity: allocation.quantity.toString(),
              balanceAfter: allocation.balanceAfter.toString(),
            })),
          },
          reason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return { allocations, balanceAfter: currentBranchBalance };
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      quantity: quantity.toString(),
      balanceAfter: result.balanceAfter.toString(),
      allocations: result.allocations.map(allocation => ({
        lotId: allocation.lotId,
        lotNumber: allocation.lotNumber,
        quantity: allocation.quantity.toString(),
      })),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = ["INSUFFICIENT_AVAILABLE_STOCK","REQUESTED_LOT_INSUFFICIENT_OR_EXPIRED","FEFO_STOCK_INSUFFICIENT"];
    return NextResponse.json({ error: known.includes(code) ? code.toLowerCase() : "inventory_consumption_failed" }, { status: 409 });
  }
}
