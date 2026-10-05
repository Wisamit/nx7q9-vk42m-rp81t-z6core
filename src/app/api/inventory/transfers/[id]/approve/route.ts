import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function positive(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,4})?$/.test(raw)) throw new Error("INVALID_DECIMAL");
  const number = new Prisma.Decimal(raw);
  if (number.lte(0)) throw new Error("INVALID_DECIMAL");
  return number;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.transfer");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { items?: Array<{ transferItemId?: string; approvedQty?: unknown }> } | null;

  const transfer = await prisma.inventoryTransfer.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { items: true },
  });
  if (!transfer) return NextResponse.json({ error: "inventory_transfer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, transfer.sourceBranchId)) return NextResponse.json({ error: "source_branch_forbidden" }, { status: 403 });
  if (transfer.status !== "DRAFT") return NextResponse.json({ error: "inventory_transfer_not_approvable", status: transfer.status }, { status: 409 });

  const requestedApproval = new Map((body?.items || []).map(item => [item.transferItemId || "", item.approvedQty]));
  try {
    const approved = await prisma.$transaction(async tx => {
      const current = await tx.inventoryTransfer.findUnique({ where: { id: transfer.id }, select: { status: true } });
      if (!current || current.status !== "DRAFT") throw new Error("STATE_CHANGED");

      for (const line of transfer.items) {
        const approvedQty = requestedApproval.has(line.id) ? positive(requestedApproval.get(line.id)) : line.requestedQty;
        if (approvedQty.gt(line.requestedQty)) throw new Error("APPROVED_EXCEEDS_REQUESTED");

        const [lotStock, branchStock] = await Promise.all([
          tx.inventoryLotStock.findUnique({ where: { branchId_lotId: { branchId: transfer.sourceBranchId, lotId: line.lotId } } }),
          tx.branchStock.findUnique({ where: { branchId_itemId: { branchId: transfer.sourceBranchId, itemId: line.itemId } } }),
        ]);
        if (!lotStock || !branchStock) throw new Error("SOURCE_STOCK_NOT_FOUND");
        const lotAvailable = lotStock.quantityOnHand.sub(lotStock.reservedQty);
        const itemAvailable = branchStock.quantityOnHand.sub(branchStock.reservedQty);
        if (lotAvailable.lt(approvedQty) || itemAvailable.lt(approvedQty)) throw new Error("INSUFFICIENT_AVAILABLE_STOCK");

        await tx.inventoryLotStock.update({ where: { id: lotStock.id }, data: { reservedQty: { increment: approvedQty } } });
        await tx.branchStock.update({ where: { id: branchStock.id }, data: { reservedQty: { increment: approvedQty } } });
        await tx.inventoryTransferItem.update({ where: { id: line.id }, data: { approvedQty } });
      }

      const approvedAt = new Date();
      const updated = await tx.inventoryTransfer.update({
        where: { id: transfer.id },
        data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt },
        include: { items: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: transfer.sourceBranchId,
          actorUserId: session.user.id,
          action: "INVENTORY_TRANSFER_APPROVED",
          entityType: "InventoryTransfer",
          entityId: transfer.id,
          oldValues: { status: "DRAFT" },
          newValues: {
            status: "APPROVED",
            approvedAt,
            items: updated.items.map(line => ({ id: line.id, approvedQty: line.approvedQty?.toString() || null })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return updated;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({ status: "ok", transfer: approved });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = ["INVALID_DECIMAL","STATE_CHANGED","APPROVED_EXCEEDS_REQUESTED","SOURCE_STOCK_NOT_FOUND","INSUFFICIENT_AVAILABLE_STOCK"];
    return NextResponse.json({ error: known.includes(code) ? code.toLowerCase() : "inventory_transfer_approve_failed" }, { status: 409 });
  }
}
