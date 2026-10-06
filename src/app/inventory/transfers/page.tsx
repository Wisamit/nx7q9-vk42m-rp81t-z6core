import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryTransferManager } from "@/components/inventory-transfer-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function InventoryTransfersPage() {
  const session = await requirePermission("inventory.transfer");
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, lotStocks, transfers] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
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

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const availableLots = lotStocks.map(stock => ({
    branchId: stock.branchId,
    lotId: stock.lotId,
    itemId: stock.lot.itemId,
    itemCode: stock.lot.item.code,
    itemName: localizedName(stock.lot.item),
    lotNumber: stock.lot.lotNumber,
    expiryDate: stock.lot.expiryDate?.toISOString().slice(0,10) || null,
    availableQty: stock.quantityOnHand.sub(stock.reservedQty).toString(),
    stockUnit: stock.lot.item.stockUnit,
  })).filter(stock => Number(stock.availableQty) > 0);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Multi-branch Inventory", "مخزون متعدد الفروع")}</p>
        <h1>{tr(locale, "Stock Transfers", "نقل المخزون")}</h1>
        <p className="muted">{tr(locale, "Request, reserve, dispatch and reconcile lot-level stock between authorized branches.", "طلب وحجز وإرسال وتسوية المخزون على مستوى التشغيلات بين الفروع المصرح بها.")}</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">{tr(locale, "Inventory", "المخزون")}</Link>
        <Link className="secondary-link" href="/inventory/procurement">{tr(locale, "Procurement", "المشتريات")}</Link>
      </div>
    </header>

    <InventoryTransferManager
      locale={locale}
      branches={branches}
      lotStocks={availableLots}
      transfers={transfers.map(transfer => ({
        id: transfer.id,
        transferNumber: transfer.transferNumber,
        sourceBranchId: transfer.sourceBranchId,
        destinationBranchId: transfer.destinationBranchId,
        sourceBranchName: localizedName(transfer.sourceBranch),
        destinationBranchName: localizedName(transfer.destinationBranch),
        status: transfer.status,
        canSourceAct: branchIds.includes(transfer.sourceBranchId),
        canDestinationAct: branchIds.includes(transfer.destinationBranchId),
        items: transfer.items.map(line => ({
          id: line.id,
          itemCode: line.item.code,
          itemName: localizedName(line.item),
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
