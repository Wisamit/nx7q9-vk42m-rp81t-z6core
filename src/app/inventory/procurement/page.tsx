import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ProcurementManager } from "@/components/procurement-manager";
import { ProcurementActionButton } from "@/components/procurement-action-button";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const session = await requirePermission("procurement.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, items, suppliers, purchaseRequests, purchaseOrders] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true, stockUnit: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
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
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) => locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Inventory Procurement", "مشتريات المخزون")}</p>
        <h1>{tr(locale, "Purchase Requests & Orders", "طلبات وأوامر الشراء")}</h1>
        <p className="muted">{tr(locale, "Branch-scoped procurement documents with approval history and quantity/cost snapshots.", "مستندات مشتريات ضمن نطاق الفروع مع سجل الموافقات ولقطات محفوظة للكميات والتكاليف.")}</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">{tr(locale, "Inventory", "المخزون")}</Link>
        <Link className="secondary-link" href="/inventory/transfers">{tr(locale, "Stock Transfers", "نقل المخزون")}</Link>
      </div>
    </header>

    <ProcurementManager
      locale={locale}
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
        <div className="table-toolbar"><h2>{tr(locale, "Purchase Requests", "طلبات الشراء")}</h2><span>{purchaseRequests.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Request", "الطلب")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Requested by", "مقدم الطلب")}</th><th>{tr(locale, "Items", "الأصناف")}</th><th>{tr(locale, "Approval", "الموافقة")}</th></tr></thead>
          <tbody>{purchaseRequests.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No purchase requests.", "لا توجد طلبات شراء.")}</td></tr> : purchaseRequests.map(request => <tr key={request.id}>
            <td><strong>{request.requestNumber}</strong><br/><small>{request.requestedAt.toISOString().slice(0,10)}</small></td>
            <td>{request.branch.code}</td>
            <td>{statusLabel(locale, request.status)}</td>
            <td>{userName(request.requestedBy)}</td>
            <td>{request.items.map(line => line.item.code + " × " + line.requestedQty.toString()).join(", ")}</td>
            <td>{permissions.has("procurement.approve") && ["DRAFT","SUBMITTED"].includes(request.status)
              ? <ProcurementActionButton locale={locale} endpoint={`/api/inventory/purchase-requests/${request.id}/approve`} label={tr(locale, "Approve", "موافقة")} confirmText={tr(locale, "Approve this purchase request?", "هل تريد الموافقة على طلب الشراء؟")} />
              : request.approvedBy ? userName(request.approvedBy) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Purchase Orders", "أوامر الشراء")}</h2><span>{purchaseOrders.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "PO", "أمر الشراء")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Supplier", "المورد")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Items", "الأصناف")}</th><th>{tr(locale, "Approval", "الموافقة")}</th></tr></thead>
          <tbody>{purchaseOrders.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No purchase orders.", "لا توجد أوامر شراء.")}</td></tr> : purchaseOrders.map(order => <tr key={order.id}>
            <td><strong>{order.poNumber}</strong><br/><small>{order.currency}{order.purchaseRequest ? " · " + order.purchaseRequest.requestNumber : ""}</small></td>
            <td>{order.branch.code}</td>
            <td>{localizedName(order.supplier)}</td>
            <td>{statusLabel(locale, order.status)}</td>
            <td>{order.items.map(line => line.item.code + " × " + line.orderedQty.toString() + " @ " + line.unitCost.toString()).join(", ")}</td>
            <td>{permissions.has("procurement.approve") && order.status === "DRAFT"
              ? <ProcurementActionButton locale={locale} endpoint={`/api/inventory/purchase-orders/${order.id}/approve`} label={tr(locale, "Approve", "موافقة")} confirmText={tr(locale, "Approve this purchase order?", "هل تريد الموافقة على أمر الشراء؟")} />
              : order.approvedBy ? userName(order.approvedBy) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>
  </main>;
}
