import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decimal(value: unknown, allowNull = false) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  const raw = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(raw)) throw new Error("INVALID_DECIMAL");
  return new Prisma.Decimal(raw);
}

export async function POST(request: Request) {
  const session = await requirePermission("inventory.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 220);
  const nameAr = text(body.nameAr, 220) || null;
  const categoryId = text(body.categoryId, 36) || null;
  const itemType = ["REAGENT","CONTROL","CALIBRATOR","KIT","TUBE","NEEDLE","CONSUMABLE","OTHER"].includes(body.itemType)
    ? body.itemType
    : null;
  const stockUnit = text(body.stockUnit, 50);

  if (!code || !nameEn || !itemType || !stockUnit) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  let minimumStockQty: Prisma.Decimal;
  let reorderQty: Prisma.Decimal | null;
  try {
    minimumStockQty = decimal(body.minimumStockQty ?? "0")!;
    reorderQty = decimal(body.reorderQty, true);
  } catch {
    return NextResponse.json({ error: "invalid_quantity" }, { status: 400 });
  }

  if (categoryId) {
    const category = await prisma.inventoryCategory.findFirst({
      where: { id: categoryId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!category) return NextResponse.json({ error: "inventory_category_not_found" }, { status: 404 });
  }

  try {
    const item = await prisma.$transaction(async tx => {
      const created = await tx.inventoryItem.create({
        data: {
          organizationId: session.user.organizationId,
          categoryId,
          code,
          nameEn,
          nameAr,
          itemType,
          stockUnit,
          minimumStockQty,
          reorderQty,
          storageConditions: text(body.storageConditions, 500) || null,
          lotTracking: body.lotTracking !== false,
          expiryTracking: body.expiryTracking !== false,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "INVENTORY_ITEM_CREATED",
          entityType: "InventoryItem",
          entityId: created.id,
          newValues: {
            code,
            nameEn,
            categoryId,
            itemType,
            stockUnit,
            minimumStockQty: minimumStockQty.toString(),
            reorderQty: reorderQty?.toString() || null,
            lotTracking: created.lotTracking,
            expiryTracking: created.expiryTracking,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", item }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "inventory_item_create_failed" }, { status: 409 });
  }
}
