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
  const session = await requirePermission("inventory.transfer");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    transferNumber?: unknown;
    sourceBranchId?: unknown;
    destinationBranchId?: unknown;
    notes?: unknown;
    items?: Array<{ itemId?: unknown; lotId?: unknown; requestedQty?: unknown }>;
  } | null;

  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const transferNumber = text(body.transferNumber, 80).toUpperCase();
  const sourceBranchId = text(body.sourceBranchId, 36);
  const destinationBranchId = text(body.destinationBranchId, 36);
  if (!transferNumber || !sourceBranchId || !destinationBranchId || sourceBranchId === destinationBranchId) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, destinationBranchId)) {
    return NextResponse.json({ error: "destination_branch_forbidden" }, { status: 403 });
  }

  const [sourceBranch, destinationBranch] = await Promise.all([
    prisma.branch.findFirst({ where: { id: sourceBranchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.branch.findFirst({ where: { id: destinationBranchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);
  if (!sourceBranch || !destinationBranch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const lotIds = body.items.map(item => text(item.lotId, 36));
  if (new Set(lotIds).size !== lotIds.length || lotIds.some(id => !id)) {
    return NextResponse.json({ error: "duplicate_or_missing_transfer_lots" }, { status: 400 });
  }
  const lots = await prisma.inventoryLot.findMany({
    where: { id: { in: lotIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: { item: true, branchStocks: { where: { branchId: sourceBranchId } } },
  });
  if (lots.length !== lotIds.length) return NextResponse.json({ error: "inventory_lot_not_found" }, { status: 404 });
  const lotById = new Map(lots.map(lot => [lot.id, lot]));

  try {
    const lines = body.items.map(raw => {
      const lotId = text(raw.lotId, 36);
      const itemId = text(raw.itemId, 36);
      const lot = lotById.get(lotId);
      if (!lot || lot.itemId !== itemId) throw new Error("LOT_ITEM_MISMATCH");
      if (!lot.branchStocks[0] || lot.branchStocks[0].quantityOnHand.lte(0)) throw new Error("LOT_NOT_IN_SOURCE_BRANCH");
      return { itemId, lotId, requestedQty: positive(raw.requestedQty) };
    });

    const transfer = await prisma.$transaction(async tx => {
      const created = await tx.inventoryTransfer.create({
        data: {
          organizationId: session.user.organizationId,
          transferNumber,
          sourceBranchId,
          destinationBranchId,
          requestedByUserId: session.user.id,
          notes: text(body.notes, 2000) || null,
          items: { create: lines },
        },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: destinationBranchId,
          actorUserId: session.user.id,
          action: "INVENTORY_TRANSFER_REQUESTED",
          entityType: "InventoryTransfer",
          entityId: created.id,
          newValues: {
            transferNumber,
            sourceBranchId,
            destinationBranchId,
            items: lines.map(line => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.requestedQty.toString() })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", transfer }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["INVALID_DECIMAL","LOT_ITEM_MISMATCH","LOT_NOT_IN_SOURCE_BRANCH"].includes(code)) {
      return NextResponse.json({ error: code.toLowerCase() }, { status: 409 });
    }
    return NextResponse.json({ error: "inventory_transfer_create_failed" }, { status: 409 });
  }
}
