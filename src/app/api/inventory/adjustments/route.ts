import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  const session = await requirePermission("inventory.adjust");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    branchId?: unknown; itemId?: unknown; lotId?: unknown; movementType?: unknown; quantity?: unknown; reason?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const itemId = text(body.itemId, 36);
  const lotId = text(body.lotId, 36);
  const movementType = ["ADJUSTMENT_IN","ADJUSTMENT_OUT","DISPOSAL"].includes(String(body.movementType))
    ? String(body.movementType) as "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DISPOSAL"
    : null;
  const reason = text(body.reason, 500);
  if (!branchId || !itemId || !lotId || !movementType || !reason) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  let quantity: Prisma.Decimal;
  try { quantity = positive(body.quantity); }
  catch { return NextResponse.json({ error: "invalid_quantity" }, { status: 400 }); }

  const [item, lot] = await Promise.all([
    prisma.inventoryItem.findFirst({ where: { id: itemId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.inventoryLot.findFirst({ where: { id: lotId, organizationId: session.user.organizationId, itemId, status: "ACTIVE" } }),
  ]);
  if (!item || !lot) return NextResponse.json({ error: "inventory_item_or_lot_not_found" }, { status: 404 });

  try {
    const result = await prisma.$transaction(async tx => {
      const [lotStock, branchStock] = await Promise.all([
        tx.inventoryLotStock.findUnique({ where: { branchId_lotId: { branchId, lotId } } }),
        tx.branchStock.findUnique({ where: { branchId_itemId: { branchId, itemId } } }),
      ]);

      if (movementType === "ADJUSTMENT_IN") {
        const nextBranch = await tx.branchStock.upsert({
          where: { branchId_itemId: { branchId, itemId } },
          create: { branchId, itemId, quantityOnHand: quantity },
          update: { quantityOnHand: { increment: quantity } },
        });
        await tx.inventoryLotStock.upsert({
          where: { branchId_lotId: { branchId, lotId } },
          create: { branchId, lotId, quantityOnHand: quantity },
          update: { quantityOnHand: { increment: quantity } },
        });
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            itemId,
            lotId,
            movementType,
            quantity,
            balanceAfter: nextBranch.quantityOnHand,
            reason,
            actorUserId: session.user.id,
          },
        });
        return { movement, balance: nextBranch.quantityOnHand };
      }

      if (!lotStock || !branchStock) throw new Error("STOCK_NOT_FOUND");
      const lotAvailable = lotStock.quantityOnHand.sub(lotStock.reservedQty);
      const branchAvailable = branchStock.quantityOnHand.sub(branchStock.reservedQty);
      if (lotAvailable.lt(quantity) || branchAvailable.lt(quantity)) throw new Error("INSUFFICIENT_AVAILABLE_STOCK");

      const nextBalance = branchStock.quantityOnHand.sub(quantity);
      await tx.inventoryLotStock.update({ where: { id: lotStock.id }, data: { quantityOnHand: { decrement: quantity } } });
      await tx.branchStock.update({ where: { id: branchStock.id }, data: { quantityOnHand: { decrement: quantity } } });
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          itemId,
          lotId,
          movementType,
          quantity: quantity.negated(),
          balanceAfter: nextBalance,
          reason,
          actorUserId: session.user.id,
        },
      });
      return { movement, balance: nextBalance };
    }, { isolationLevel: "Serializable", timeout: 30000 });

    await prisma.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "INVENTORY_STOCK_ADJUSTED",
        entityType: "InventoryItem",
        entityId: itemId,
        newValues: {
          lotId,
          movementType,
          quantity: quantity.toString(),
          balanceAfter: result.balance.toString(),
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return NextResponse.json({ status: "ok", movement: result.movement, balanceAfter: result.balance.toString() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = ["STOCK_NOT_FOUND","INSUFFICIENT_AVAILABLE_STOCK"];
    return NextResponse.json({ error: known.includes(code) ? code.toLowerCase() : "inventory_adjustment_failed" }, { status: 409 });
  }
}
