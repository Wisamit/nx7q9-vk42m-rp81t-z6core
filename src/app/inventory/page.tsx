import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryManager } from "@/components/inventory-manager";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await requirePermission("inventory.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [categories, suppliers, items, branches, branchStocks, lotStocks, receipts] = await Promise.all([
    prisma.inventoryCategory.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { category: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branchStock.findMany({
      where: { branchId: { in: branchIds } },
      include: { branch: true, item: { include: { category: true } } },
      orderBy: [{ branch: { nameEn: "asc" } }, { item: { nameEn: "asc" } }],
    }),
    prisma.inventoryLotStock.findMany({
      where: { branchId: { in: branchIds }, quantityOnHand: { gt: 0 } },
      include: { branch: true, lot: { include: { item: true, supplier: true } } },
    }),
    prisma.goodsReceipt.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: { branch: true, supplier: true, items: { include: { item: true, lot: true } } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
  ]);

  const fefoLots = [...lotStocks].sort((a, b) => {
    const aExpiry = a.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bExpiry = b.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aExpiry - bExpiry;
  });

  const lowStock = branchStocks.filter(stock => stock.quantityOnHand.lte(stock.item.minimumStockQty));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Inventory & Procurement</p>
        <h1>Inventory</h1>
        <p className="muted">Branch-specific stock with lot/expiry traceability, FEFO visibility and immutable stock movements.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Items</h2><strong>{items.length}</strong><p className="muted">Active inventory master records.</p></article>
      <article className="detail-card"><h2>Low Stock</h2><strong>{lowStock.length}</strong><p className="muted">Branch/item balances at or below configured minimum.</p></article>
      <article className="detail-card"><h2>Lots in Stock</h2><strong>{fefoLots.length}</strong><p className="muted">Positive lot balances across your authorized branches.</p></article>
      <article className="detail-card"><h2>Recent Receipts</h2><strong>{receipts.length}</strong><p className="muted">Latest supplier receipt documents shown.</p></article>
    </section>

    <InventoryManager
      categories={categories.map(category => ({ id: category.id, code: category.code, nameEn: category.nameEn }))}
      suppliers={suppliers.map(supplier => ({ id: supplier.id, code: supplier.code, nameEn: supplier.nameEn }))}
      items={items.map(item => ({ id: item.id, code: item.code, nameEn: item.nameEn, stockUnit: item.stockUnit, itemType: item.itemType, lotTracking: item.lotTracking, expiryTracking: item.expiryTracking }))}
      branches={branches}
      canManage={permissions.has("inventory.manage")}
      canReceive={permissions.has("procurement.receive")}
    />

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Branch Stock</h2><span>{branchStocks.length} balances</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Branch</th><th>Item</th><th>Type</th><th>On hand</th><th>Reserved</th><th>Minimum</th><th>Status</th></tr></thead>
          <tbody>{branchStocks.length === 0 ? <tr><td colSpan={7} className="empty-state">No stock posted yet.</td></tr> : branchStocks.map(stock => <tr key={stock.id}>
            <td>{stock.branch.code} — {stock.branch.nameEn}</td>
            <td><strong>{stock.item.code}</strong><br/><small>{stock.item.nameEn}</small></td>
            <td>{stock.item.itemType}</td>
            <td>{stock.quantityOnHand.toString()} {stock.item.stockUnit}</td>
            <td>{stock.reservedQty.toString()}</td>
            <td>{stock.item.minimumStockQty.toString()}</td>
            <td>{stock.quantityOnHand.lte(stock.item.minimumStockQty) ? <strong className="critical-text">LOW</strong> : "OK"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>FEFO Lots</h2><span>{fefoLots.length} positive balances</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Expiry</th><th>Branch</th><th>Item</th><th>Lot</th><th>Supplier</th><th>On hand</th></tr></thead>
          <tbody>{fefoLots.length === 0 ? <tr><td colSpan={6} className="empty-state">No lot stock available.</td></tr> : fefoLots.map(stock => <tr key={stock.id}>
            <td>{stock.lot.expiryDate?.toISOString().slice(0,10) || "No expiry"}</td>
            <td>{stock.branch.code}</td>
            <td><strong>{stock.lot.item.code}</strong><br/><small>{stock.lot.item.nameEn}</small></td>
            <td>{stock.lot.lotNumber}</td>
            <td>{stock.lot.supplier?.nameEn || "—"}</td>
            <td>{stock.quantityOnHand.toString()} {stock.lot.item.stockUnit}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Recent Goods Receipts</h2><span>{receipts.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Receipt</th><th>Branch</th><th>Supplier</th><th>Status</th><th>Received</th><th>Lines</th></tr></thead>
        <tbody>{receipts.length === 0 ? <tr><td colSpan={6} className="empty-state">No goods receipts yet.</td></tr> : receipts.map(receipt => <tr key={receipt.id}>
          <td><strong>{receipt.receiptNumber}</strong><br/><small>{receipt.supplierReference || "—"}</small></td>
          <td>{receipt.branch.code}</td>
          <td>{receipt.supplier.nameEn}</td>
          <td>{receipt.status}</td>
          <td>{receipt.receivedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{receipt.items.length}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
