import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryOperationsManager } from "@/components/inventory-operations-manager";

export const dynamic = "force-dynamic";

export default async function InventoryOperationsPage() {
  const session = await requirePermission("inventory.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, items, lotStocks, movements] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, stockUnit: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.inventoryLotStock.findMany({
      where: { branchId: { in: branchIds } },
      include: { lot: { include: { item: true } }, branch: true },
    }),
    prisma.stockMovement.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: { branch: true, item: true, lot: true, actor: true },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Inventory Operations</p>
        <h1>Adjustments & Consumption</h1>
        <p className="muted">Audited lot-level stock corrections and FEFO consumption for authorized branches.</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">Inventory</Link>
        <Link className="secondary-link" href="/inventory/procurement">Procurement</Link>
        <Link className="secondary-link" href="/inventory/transfers">Transfers</Link>
      </div>
    </header>

    <InventoryOperationsManager
      branches={branches}
      items={items}
      lots={lotStocks.map(stock => ({
        branchId: stock.branchId,
        itemId: stock.lot.itemId,
        lotId: stock.lotId,
        lotNumber: stock.lot.lotNumber,
        expiryDate: stock.lot.expiryDate?.toISOString().slice(0,10) || null,
        onHand: stock.quantityOnHand.toString(),
        reserved: stock.reservedQty.toString(),
      }))}
      canAdjust={permissions.has("inventory.adjust")}
      canConsume={permissions.has("inventory.consume")}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Stock Movement Ledger</h2><span>{movements.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Branch</th><th>Item</th><th>Lot</th><th>Type</th><th>Quantity</th><th>Balance after</th><th>Actor</th><th>Reference</th></tr></thead>
        <tbody>{movements.length === 0 ? <tr><td colSpan={9} className="empty-state">No stock movements yet.</td></tr> : movements.map(movement => <tr key={movement.id}>
          <td>{movement.occurredAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td>{movement.branch.code}</td>
          <td><strong>{movement.item.code}</strong><br/><small>{movement.item.nameEn}</small></td>
          <td>{movement.lot?.lotNumber || "—"}</td>
          <td>{movement.movementType}</td>
          <td>{movement.quantity.toString()}</td>
          <td>{movement.balanceAfter.toString()}</td>
          <td>{movement.actor.displayNameEn}</td>
          <td>{movement.referenceType ? movement.referenceType + (movement.referenceId ? " · " + movement.referenceId : "") : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
