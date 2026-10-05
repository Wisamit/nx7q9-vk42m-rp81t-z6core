import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function positiveDecimal(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(raw)) throw new Error("INVALID_DECIMAL");
  const parsed = new Prisma.Decimal(raw);
  if (parsed.lte(0)) throw new Error("INVALID_DECIMAL");
  return parsed;
}

export async function POST(request: Request) {
  const session = await requirePermission("procurement.receive");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    branchId?: unknown; supplierId?: unknown; purchaseOrderId?: unknown; receiptNumber?: unknown;
    supplierReference?: unknown; receivedAt?: unknown; notes?: unknown;
    items?: Array<{ purchaseOrderItemId?: unknown; itemId?: unknown; lotNumber?: unknown; expiryDate?: unknown; quantity?: unknown; unitCost?: unknown; currency?: unknown }>;
  } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const branchId = text(body.branchId, 36);
  const supplierId = text(body.supplierId, 36);
  const purchaseOrderId = text(body.purchaseOrderId, 36) || null;
  const receiptNumber = text(body.receiptNumber, 80).toUpperCase();
  const receivedAt = body.receivedAt ? new Date(String(body.receivedAt)) : new Date();
  if (!branchId || !supplierId || !receiptNumber || Number.isNaN(receivedAt.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [branchRecord, supplier, purchaseOrder] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.supplier.findFirst({ where: { id: supplierId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    purchaseOrderId ? prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId: session.user.organizationId },
      include: { items: true },
    }) : Promise.resolve(null),
  ]);
  if (!branchRecord || !supplier) return NextResponse.json({ error: "branch_or_supplier_not_found" }, { status: 404 });
  if (purchaseOrderId && !purchaseOrder) return NextResponse.json({ error: "purchase_order_not_found" }, { status: 404 });
  if (purchaseOrder && (purchaseOrder.branchId !== branchId || purchaseOrder.supplierId !== supplierId)) {
    return NextResponse.json({ error: "purchase_order_context_mismatch" }, { status: 409 });
  }
  if (purchaseOrder && ["CANCELLED","RECEIVED"].includes(purchaseOrder.status)) {
    return NextResponse.json({ error: "purchase_order_not_receivable", status: purchaseOrder.status }, { status: 409 });
  }

  const itemIds = [...new Set(body.items.map(item => text(item.itemId, 36)).filter(Boolean))];
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (inventoryItems.length !== itemIds.length) return NextResponse.json({ error: "inventory_item_not_found" }, { status: 404 });
  const itemById = new Map(inventoryItems.map(item => [item.id, item]));

  const prepared = [];
  try {
    for (const raw of body.items) {
      const itemId = text(raw.itemId, 36);
      const item = itemById.get(itemId);
      if (!item) return NextResponse.json({ error: "inventory_item_not_found", itemId }, { status: 404 });
      const purchaseOrderItemId = text(raw.purchaseOrderItemId, 36) || null;
      if (purchaseOrder) {
        const poLine = purchaseOrder.items.find(line => line.id === purchaseOrderItemId && line.itemId === itemId);
        if (!poLine) return NextResponse.json({ error: "purchase_order_item_mismatch", itemId }, { status: 409 });
      } else if (purchaseOrderItemId) {
        return NextResponse.json({ error: "purchase_order_item_without_order" }, { status: 409 });
      }

      const lotNumber = (text(raw.lotNumber, 120) || (item.lotTracking ? "" : "NOLOT")).toUpperCase();
      if (!lotNumber) return NextResponse.json({ error: "lot_number_required", itemId }, { status: 400 });
      const expiryDate = raw.expiryDate ? new Date(String(raw.expiryDate)) : null;
      if (expiryDate && Number.isNaN(expiryDate.getTime())) return NextResponse.json({ error: "invalid_expiry_date", itemId }, { status: 400 });
      if (item.expiryTracking && !expiryDate) return NextResponse.json({ error: "expiry_date_required", itemId }, { status: 400 });

      const quantity = positiveDecimal(raw.quantity);
      const unitCost = positiveDecimal(raw.unitCost);
      const currency = text(raw.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "invalid_currency", itemId }, { status: 400 });
      prepared.push({ purchaseOrderItemId, itemId, lotNumber, expiryDate, quantity, unitCost, currency });
    }
  } catch {
    return NextResponse.json({ error: "invalid_receipt_quantity_or_cost" }, { status: 400 });
  }

  try {
    const receipt = await prisma.$transaction(async tx => {
      const created = await tx.goodsReceipt.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          supplierId,
          purchaseOrderId,
          receiptNumber,
          supplierReference: text(body.supplierReference, 150) || null,
          receivedByUserId: session.user.id,
          receivedAt,
          notes: text(body.notes, 2000) || null,
          items: { create: prepared },
        },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "GOODS_RECEIPT_CREATED",
          entityType: "GoodsReceipt",
          entityId: created.id,
          newValues: {
            receiptNumber,
            supplierId,
            purchaseOrderId,
            itemCount: prepared.length,
            items: prepared.map(item => ({ itemId: item.itemId, lotNumber: item.lotNumber, quantity: item.quantity.toString(), unitCost: item.unitCost.toString(), currency: item.currency })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", receipt }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "goods_receipt_create_failed" }, { status: 409 });
  }
}
