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
  const session = await requirePermission("procurement.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    branchId?: unknown; supplierId?: unknown; purchaseRequestId?: unknown; poNumber?: unknown; currency?: unknown;
    supplierReference?: unknown; expectedAt?: unknown; notes?: unknown;
    items?: Array<{ itemId?: unknown; orderedQty?: unknown; unitCost?: unknown }>;
  } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const supplierId = text(body.supplierId, 36);
  const purchaseRequestId = text(body.purchaseRequestId, 36) || null;
  const poNumber = text(body.poNumber, 80).toUpperCase();
  const currency = text(body.currency, 3).toUpperCase();
  const expectedAt = body.expectedAt ? new Date(String(body.expectedAt)) : null;
  if (!branchId || !supplierId || !poNumber || !/^[A-Z]{3}$/.test(currency) || (expectedAt && Number.isNaN(expectedAt.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [branchRecord, supplier, purchaseRequest] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.supplier.findFirst({ where: { id: supplierId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    purchaseRequestId ? prisma.purchaseRequest.findFirst({
      where: { id: purchaseRequestId, organizationId: session.user.organizationId },
      include: { items: true },
    }) : Promise.resolve(null),
  ]);
  if (!branchRecord || !supplier) return NextResponse.json({ error: "branch_or_supplier_not_found" }, { status: 404 });
  if (purchaseRequestId && !purchaseRequest) return NextResponse.json({ error: "purchase_request_not_found" }, { status: 404 });
  if (purchaseRequest && (purchaseRequest.branchId !== branchId || purchaseRequest.status !== "APPROVED")) {
    return NextResponse.json({ error: "purchase_request_not_convertible", status: purchaseRequest.status }, { status: 409 });
  }

  const ids = body.items.map(line => text(line.itemId, 36));
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) return NextResponse.json({ error: "duplicate_or_missing_order_items" }, { status: 400 });
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids }, organizationId: session.user.organizationId, status: "ACTIVE" } });
  if (items.length !== ids.length) return NextResponse.json({ error: "inventory_item_not_found" }, { status: 404 });

  try {
    const lines = body.items.map(line => ({ itemId: text(line.itemId, 36), orderedQty: positive(line.orderedQty), unitCost: positive(line.unitCost) }));
    if (purchaseRequest) {
      for (const line of lines) {
        const requested = purchaseRequest.items.find(item => item.itemId === line.itemId);
        if (!requested) return NextResponse.json({ error: "purchase_order_item_not_in_approved_request", itemId: line.itemId }, { status: 409 });
        if (line.orderedQty.gt(requested.requestedQty)) {
          return NextResponse.json({ error: "purchase_order_quantity_exceeds_approved_request", itemId: line.itemId }, { status: 409 });
        }
      }
    }
    const created = await prisma.$transaction(async tx => {
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          supplierId,
          purchaseRequestId,
          poNumber,
          currency,
          supplierReference: text(body.supplierReference, 150) || null,
          expectedAt,
          createdByUserId: session.user.id,
          notes: text(body.notes, 2000) || null,
          items: { create: lines },
        },
        include: { items: true },
      });
      if (purchaseRequestId) await tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { status: "CONVERTED" } });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "PURCHASE_ORDER_CREATED",
          entityType: "PurchaseOrder",
          entityId: po.id,
          newValues: { poNumber, supplierId, purchaseRequestId, currency, items: lines.map(line => ({ itemId: line.itemId, orderedQty: line.orderedQty.toString(), unitCost: line.unitCost.toString() })) },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return po;
    });
    return NextResponse.json({ status: "ok", purchaseOrder: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "purchase_order_create_failed" }, { status: 409 });
  }
}
