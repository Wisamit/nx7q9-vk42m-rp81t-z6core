import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryManager } from "@/components/inventory-manager";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await requirePermission("inventory.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
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
      select: { id: true, code: true, nameEn: true, nameAr: true },
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
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const itemTypeLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      REAGENT: ["Reagent", "كاشف"],
      CONTROL: ["Control", "مادة ضبط"],
      CALIBRATOR: ["Calibrator", "مادة معايرة"],
      KIT: ["Kit", "طقم"],
      TUBE: ["Tube", "أنبوب"],
      NEEDLE: ["Needle", "إبرة"],
      CONSUMABLE: ["Consumable", "مستهلك"],
      OTHER: ["Other", "أخرى"],
    };
    const label = labels[value];
    return label ? tr(locale, label[0], label[1]) : value;
  };

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Inventory & Procurement", "المخزون والمشتريات")}</p>
        <h1>{tr(locale, "Inventory", "المخزون")}</h1>
        <p className="muted">{tr(locale, "Branch-specific stock with lot/expiry traceability, FEFO visibility and immutable stock movements.", "مخزون خاص بكل فرع مع تتبع التشغيلات وتواريخ الانتهاء وسياسة FEFO وحركات مخزون غير قابلة للتلاعب.")}</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory/procurement">{tr(locale, "Procurement", "المشتريات")}</Link>
        <Link className="secondary-link" href="/inventory/transfers">{tr(locale, "Stock Transfers", "نقل المخزون")}</Link>
        <Link className="secondary-link" href="/inventory/operations">{tr(locale, "Operations", "العمليات")}</Link>
        <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Items", "الأصناف")}</h2><strong>{items.length}</strong><p className="muted">{tr(locale, "Active inventory master records.", "سجلات الأصناف النشطة.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Low Stock", "مخزون منخفض")}</h2><strong>{lowStock.length}</strong><p className="muted">{tr(locale, "Branch/item balances at or below configured minimum.", "أرصدة الفروع/الأصناف عند أو أقل من الحد الأدنى المحدد.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Lots in Stock", "التشغيلات بالمخزون")}</h2><strong>{fefoLots.length}</strong><p className="muted">{tr(locale, "Positive lot balances across your authorized branches.", "تشغيلات ذات رصيد موجب ضمن الفروع المصرح لك بها.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Recent Receipts", "أحدث الاستلامات")}</h2><strong>{receipts.length}</strong><p className="muted">{tr(locale, "Latest supplier receipt documents shown.", "أحدث مستندات استلام الموردين.")}</p></article>
    </section>

    <InventoryManager
      locale={locale}
      categories={categories.map(category => ({ id: category.id, code: category.code, nameEn: category.nameEn, nameAr: category.nameAr }))}
      suppliers={suppliers.map(supplier => ({ id: supplier.id, code: supplier.code, nameEn: supplier.nameEn, nameAr: supplier.nameAr }))}
      items={items.map(item => ({ id: item.id, code: item.code, nameEn: item.nameEn, nameAr: item.nameAr, stockUnit: item.stockUnit, itemType: item.itemType, lotTracking: item.lotTracking, expiryTracking: item.expiryTracking }))}
      branches={branches}
      canManage={permissions.has("inventory.manage")}
      canReceive={permissions.has("procurement.receive")}
    />

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Branch Stock", "مخزون الفروع")}</h2><span>{branchStocks.length} {tr(locale, "balances", "رصيد")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Item", "الصنف")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "On hand", "المتاح فعلياً")}</th><th>{tr(locale, "Reserved", "المحجوز")}</th><th>{tr(locale, "Minimum", "الحد الأدنى")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{branchStocks.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No stock posted yet.", "لا توجد حركات مخزون بعد.")}</td></tr> : branchStocks.map(stock => <tr key={stock.id}>
            <td>{stock.branch.code} — {localizedName(stock.branch)}</td>
            <td><strong>{stock.item.code}</strong><br/><small>{localizedName(stock.item)}</small></td>
            <td>{itemTypeLabel(stock.item.itemType)}</td>
            <td>{stock.quantityOnHand.toString()} {stock.item.stockUnit}</td>
            <td>{stock.reservedQty.toString()}</td>
            <td>{stock.item.minimumStockQty.toString()}</td>
            <td>{stock.quantityOnHand.lte(stock.item.minimumStockQty) ? <strong className="critical-text">{tr(locale, "LOW", "منخفض")}</strong> : tr(locale, "OK", "طبيعي")}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "FEFO Lots", "تشغيلات FEFO")}</h2><span>{fefoLots.length} {tr(locale, "positive balances", "أرصدة موجبة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Expiry", "الانتهاء")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Item", "الصنف")}</th><th>{tr(locale, "Lot", "التشغيلة")}</th><th>{tr(locale, "Supplier", "المورد")}</th><th>{tr(locale, "On hand", "المتاح فعلياً")}</th></tr></thead>
          <tbody>{fefoLots.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No lot stock available.", "لا يوجد مخزون تشغيلات متاح.")}</td></tr> : fefoLots.map(stock => <tr key={stock.id}>
            <td>{stock.lot.expiryDate?.toISOString().slice(0,10) || tr(locale, "No expiry", "بدون انتهاء")}</td>
            <td>{stock.branch.code} — {localizedName(stock.branch)}</td>
            <td><strong>{stock.lot.item.code}</strong><br/><small>{localizedName(stock.lot.item)}</small></td>
            <td>{stock.lot.lotNumber}</td>
            <td>{stock.lot.supplier ? localizedName(stock.lot.supplier) : "—"}</td>
            <td>{stock.quantityOnHand.toString()} {stock.lot.item.stockUnit}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Recent Goods Receipts", "أحدث استلامات البضاعة")}</h2><span>{receipts.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Receipt", "الاستلام")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Supplier", "المورد")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Received", "تاريخ الاستلام")}</th><th>{tr(locale, "Lines", "البنود")}</th></tr></thead>
        <tbody>{receipts.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No goods receipts yet.", "لا توجد استلامات بضاعة بعد.")}</td></tr> : receipts.map(receipt => <tr key={receipt.id}>
          <td><strong>{receipt.receiptNumber}</strong><br/><small>{receipt.supplierReference || "—"}</small></td>
          <td>{receipt.branch.code} — {localizedName(receipt.branch)}</td>
          <td>{localizedName(receipt.supplier)}</td>
          <td>{statusLabel(locale, receipt.status)}</td>
          <td>{receipt.receivedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{receipt.items.length}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
