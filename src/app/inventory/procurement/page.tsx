import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ProcurementManager } from "@/components/procurement-manager";
import { ProcurementActionButton } from "@/components/procurement-action-button";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const session = await requirePermission("procurement.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, items, suppliers, purchaseRequests, purchaseOrders] = await Promise.all([
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
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.purchaseRequest.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        requestedBy: true,
        approvedBy: true,
        items: { include: { item: true } },
      },
      orderBy: { requestedAt: "desc" },
      take: 100,
    }),
    prisma.purchaseOrder.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        supplier: true,
        purchaseRequest: true,
        createdBy: true,
        approvedBy: true,
        items: { include: { item: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const approvedRequests = purchaseRequests.filter(request => request.status === "APPROVED");

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Inventory Procurement</p>
        <h1>Purchase Requests & Orders</h1>
        <p className="muted">Branch-scoped procurement documents with approval history and quantity/cost snapshots.</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">Inventory</Link>
        <Link className="secondary-link" href="/inventory/transfers">Stock Transfers</Link>
      </div>
    </header>

    <ProcurementManager
      items={items}
      branches={branches}
      suppliers={suppliers}
      approvedRequests={approvedRequests.map(request => ({
        id: request.id,
        requestNumber: request.requestNumber,
        branchId: request.branchId,
        items: request.items.map(line => ({ itemId: line.itemId, requestedQty: line.requestedQty.toString() })),
      }))}
      canManage={permissions.has("procurement.manage")}
    />

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Purchase Requests</h2><span>{purchaseRequests.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Request</th><th>Branch</th><th>Status</th><th>Requested by</th><th>Items</th><th>Approval</th></tr></thead>
          <tbody>{purchaseRequests.length === 0 ? <tr><td colSpan={6} className="empty-state">No purchase requests.</td></tr> : purchaseRequests.map(request => <tr key={request.id}>
            <td><strong>{request.requestNumber}</strong><br/><small>{request.requestedAt.toISOString().slice(0,10)}</small></td>
            <td>{request.branch.code}</td>
            <td>{request.status}</td>
            <td>{request.requestedBy.displayNameEn}</td>
            <td>{request.items.map(line => line.item.code + " × " + line.requestedQty.toString()).join(", ")}</td>
            <td>{permissions.has("procurement.approve") && ["DRAFT","SUBMITTED"].includes(request.status)
              ? <ProcurementActionButton endpoint={`/api/inventory/purchase-requests/${request.id}/approve`} label="Approve" confirmText="Approve this purchase request?" />
              : request.approvedBy?.displayNameEn || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Purchase Orders</h2><span>{purchaseOrders.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>PO</th><th>Branch</th><th>Supplier</th><th>Status</th><th>Items</th><th>Approval</th></tr></thead>
          <tbody>{purchaseOrders.length === 0 ? <tr><td colSpan={6} className="empty-state">No purchase orders.</td></tr> : purchaseOrders.map(order => <tr key={order.id}>
            <td><strong>{order.poNumber}</strong><br/><small>{order.currency}{order.purchaseRequest ? " · " + order.purchaseRequest.requestNumber : ""}</small></td>
            <td>{order.branch.code}</td>
            <td>{order.supplier.nameEn}</td>
            <td>{order.status}</td>
            <td>{order.items.map(line => line.item.code + " × " + line.orderedQty.toString() + " @ " + line.unitCost.toString()).join(", ")}</td>
            <td>{permissions.has("procurement.approve") && order.status === "DRAFT"
              ? <ProcurementActionButton endpoint={`/api/inventory/purchase-orders/${order.id}/approve`} label="Approve" confirmText="Approve this purchase order?" />
              : order.approvedBy?.displayNameEn || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>
  </main>;
}
