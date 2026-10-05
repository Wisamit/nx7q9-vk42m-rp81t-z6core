import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryTransferManager } from "@/components/inventory-transfer-manager";

export const dynamic = "force-dynamic";

export default async function InventoryTransfersPage() {
  const session = await requirePermission("inventory.transfer");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, lotStocks, transfers] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.inventoryLotStock.findMany({
      where: { branchId: { in: branchIds }, quantityOnHand: { gt: 0 } },
      include: { lot: { include: { item: true } } },
    }),
    prisma.inventoryTransfer.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { sourceBranchId: { in: branchIds } },
          { destinationBranchId: { in: branchIds } },
        ],
      },
      include: {
        sourceBranch: true,
        destinationBranch: true,
        requestedBy: true,
        approvedBy: true,
        dispatchedBy: true,
        receivedBy: true,
        items: { include: { item: true, lot: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { requestedAt: "desc" },
      take: 100,
    }),
  ]);

  const availableLots = lotStocks.map(stock => ({
    branchId: stock.branchId,
    lotId: stock.lotId,
    itemId: stock.lot.itemId,
    itemCode: stock.lot.item.code,
    itemName: stock.lot.item.nameEn,
    lotNumber: stock.lot.lotNumber,
    expiryDate: stock.lot.expiryDate?.toISOString().slice(0,10) || null,
    availableQty: stock.quantityOnHand.sub(stock.reservedQty).toString(),
    stockUnit: stock.lot.item.stockUnit,
  })).filter(stock => Number(stock.availableQty) > 0);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Multi-branch Inventory</p>
        <h1>Stock Transfers</h1>
        <p className="muted">Request, reserve, dispatch and reconcile lot-level stock between authorized branches.</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">Inventory</Link>
        <Link className="secondary-link" href="/inventory/procurement">Procurement</Link>
      </div>
    </header>

    <InventoryTransferManager
      branches={branches}
      lotStocks={availableLots}
      transfers={transfers.map(transfer => ({
        id: transfer.id,
        transferNumber: transfer.transferNumber,
        sourceBranchId: transfer.sourceBranchId,
        destinationBranchId: transfer.destinationBranchId,
        sourceBranchName: transfer.sourceBranch.nameEn,
        destinationBranchName: transfer.destinationBranch.nameEn,
        status: transfer.status,
        canSourceAct: branchIds.includes(transfer.sourceBranchId),
        canDestinationAct: branchIds.includes(transfer.destinationBranchId),
        items: transfer.items.map(line => ({
          id: line.id,
          itemCode: line.item.code,
          itemName: line.item.nameEn,
          lotNumber: line.lot.lotNumber,
          requestedQty: line.requestedQty.toString(),
          approvedQty: line.approvedQty?.toString() || null,
          dispatchedQty: line.dispatchedQty?.toString() || null,
          receivedQty: line.receivedQty?.toString() || null,
          discrepancyQty: line.discrepancyQty?.toString() || null,
        })),
      }))}
    />
  </main>;
}
