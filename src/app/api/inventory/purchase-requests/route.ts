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
    branchId?: unknown; requestNumber?: unknown; notes?: unknown;
    items?: Array<{ itemId?: unknown; requestedQty?: unknown; estimatedUnitCost?: unknown; currency?: unknown; notes?: unknown }>;
  } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const requestNumber = text(body.requestNumber, 80).toUpperCase();
  if (!branchId || !requestNumber) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const branchRecord = await prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } });
  if (!branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const ids = body.items.map(line => text(line.itemId, 36));
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) return NextResponse.json({ error: "duplicate_or_missing_request_items" }, { status: 400 });
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids }, organizationId: session.user.organizationId, status: "ACTIVE" } });
  if (items.length !== ids.length) return NextResponse.json({ error: "inventory_item_not_found" }, { status: 404 });

  try {
    const lines = body.items.map(line => {
      const estimatedUnitCost = line.estimatedUnitCost === "" || line.estimatedUnitCost == null ? null : positive(line.estimatedUnitCost);
      const currency = text(line.currency, 3).toUpperCase() || null;
      if ((estimatedUnitCost && !currency) || (!estimatedUnitCost && currency)) throw new Error("ESTIMATE_CURRENCY_PAIR_REQUIRED");
      if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_CURRENCY");
      return {
        itemId: text(line.itemId, 36),
        requestedQty: positive(line.requestedQty),
        estimatedUnitCost,
        currency,
        notes: text(line.notes, 500) || null,
      };
    });

    const created = await prisma.$transaction(async tx => {
      const doc = await tx.purchaseRequest.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          requestNumber,
          requestedByUserId: session.user.id,
          notes: text(body.notes, 2000) || null,
          items: { create: lines },
        },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "PURCHASE_REQUEST_CREATED",
          entityType: "PurchaseRequest",
          entityId: doc.id,
          newValues: {
            requestNumber,
            status: doc.status,
            items: lines.map(line => ({ itemId: line.itemId, requestedQty: line.requestedQty.toString(), estimatedUnitCost: line.estimatedUnitCost?.toString() || null, currency: line.currency })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return doc;
    });
    return NextResponse.json({ status: "ok", purchaseRequest: created }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["ESTIMATE_CURRENCY_PAIR_REQUIRED","INVALID_CURRENCY","INVALID_DECIMAL"].includes(code)) return NextResponse.json({ error: code.toLowerCase() }, { status: 400 });
    return NextResponse.json({ error: "purchase_request_create_failed" }, { status: 409 });
  }
}
