import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { InventoryOperationsManager } from "@/components/inventory-operations-manager";
import {InventoryLotSafetyManager} from "@/components/inventory-lot-safety-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function InventoryOperationsPage() {
  const session = await requirePermission("inventory.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, items, lotStocks, movements] = await Promise.all([
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

  const scopedLotIds=[...new Set(lotStocks
    .filter(stock=>stock.lot.organizationId===session.user.organizationId)
    .map(stock=>stock.lotId))];
  const safetyEvents=await prisma.inventoryLotSafetyEvent.findMany({
    where:{organizationId:session.user.organizationId,lotId:{in:scopedLotIds}},
    include:{lot:true},
    orderBy:[{createdAt:"desc"},{id:"desc"}],take:50,
  });
  const safetyActors=await prisma.user.findMany({
    where:{organizationId:session.user.organizationId,
      id:{in:[...new Set(safetyEvents.map(event=>event.actorUserId))]}},
    select:{id:true,displayNameEn:true,displayNameAr:true},
  });
  const actorNames=new Map(safetyActors.map(actor=>[
    actor.id,locale==="ar"?actor.displayNameAr||actor.displayNameEn:actor.displayNameEn,
  ]));
  const safetyLots=[...new Map(lotStocks
    .filter(stock=>stock.lot.organizationId===session.user.organizationId)
    .map(stock=>[stock.lotId,stock.lot])).values()].map(lot=>({
      id:lot.id,lotNumber:lot.lotNumber,itemCode:lot.item.code,
      itemName:locale==="ar"?lot.item.nameAr||lot.item.nameEn:lot.item.nameEn,
      safetyStatus:lot.safetyStatus,expiryDate:lot.expiryDate?.toISOString().slice(0,10)||null,
      branches:lotStocks.filter(stock=>stock.lotId===lot.id).map(stock=>stock.branch.code),
    }));

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) => locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;
  const movementLabel = (value: string) => ({ ADJUSTMENT_IN: tr(locale,"Adjustment in","تسوية إضافة"), ADJUSTMENT_OUT: tr(locale,"Adjustment out","تسوية خصم"), DISPOSAL: tr(locale,"Disposal","إتلاف"), CONSUMPTION: tr(locale,"Consumption","استهلاك"), RECEIPT: tr(locale,"Receipt","استلام"), TRANSFER_OUT: tr(locale,"Transfer out","نقل صادر"), TRANSFER_IN: tr(locale,"Transfer in","نقل وارد") }[value] || value);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Inventory Operations", "عمليات المخزون")}</p>
        <h1>{tr(locale, "Adjustments & Consumption", "التسويات والاستهلاك")}</h1>
        <p className="muted">{tr(locale, "Audited lot-level stock corrections and FEFO consumption for authorized branches.", "تسويات مدققة على مستوى التشغيلات واستهلاك وفق FEFO ضمن الفروع المصرح بها.")}</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/inventory">{tr(locale, "Inventory", "المخزون")}</Link>
        <Link className="secondary-link" href="/inventory/procurement">{tr(locale, "Procurement", "المشتريات")}</Link>
        <Link className="secondary-link" href="/inventory/transfers">{tr(locale, "Transfers", "النقل")}</Link>
        {permissions.has("quality.nonconformance.manage") && <Link className="secondary-link" href="/inventory/recall-quality">{tr(locale, "Recall quality follow-up", "متابعة جودة الاستدعاءات")}</Link>}
      </div>
    </header>

    <InventoryOperationsManager
      locale={locale}
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

    <InventoryLotSafetyManager locale={locale} lots={safetyLots}
      canManage={permissions.has("inventory.manage")}
      history={safetyEvents.map(event=>({
        id:event.id,lotId:event.lotId,lotNumber:event.lot.lotNumber,
        priorStatus:event.priorStatus,nextStatus:event.nextStatus,
        reason:event.reason,at:event.createdAt.toISOString(),
        actor:actorNames.get(event.actorUserId)||"—",
      }))}/>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Stock Movement Ledger", "سجل حركات المخزون")}</h2><span>{movements.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Time", "الوقت")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Item", "الصنف")}</th><th>{tr(locale, "Lot", "التشغيلة")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Quantity", "الكمية")}</th><th>{tr(locale, "Balance after", "الرصيد بعد الحركة")}</th><th>{tr(locale, "Actor", "المنفذ")}</th><th>{tr(locale, "Reference", "المرجع")}</th></tr></thead>
        <tbody>{movements.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No stock movements yet.", "لا توجد حركات مخزون بعد.")}</td></tr> : movements.map(movement => <tr key={movement.id}>
          <td>{<SystemDateText value={movement.occurredAt.toISOString()} timeZone={movement.branch.timezone} />}</td>
          <td>{movement.branch.code}</td>
          <td><strong>{movement.item.code}</strong><br/><small>{localizedName(movement.item)}</small></td>
          <td>{movement.lot?.lotNumber || "—"}</td>
          <td>{movementLabel(movement.movementType)}</td>
          <td>{movement.quantity.toString()}</td>
          <td>{movement.balanceAfter.toString()}</td>
          <td>{userName(movement.actor)}</td>
          <td>{movement.referenceType ? movement.referenceType + (movement.referenceId ? " · " + movement.referenceId : "") : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
