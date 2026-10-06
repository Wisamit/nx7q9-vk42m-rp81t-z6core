import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenActions } from "@/components/specimen-actions";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function SpecimensPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requirePermission("specimens.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [specimens, branches] = await Promise.all([
    prisma.specimen.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { currentBranchId: { in: branchIds } },
          { order: { orderingBranchId: { in: branchIds } } },
        ],
        ...(status && ["PLANNED","COLLECTED","RECEIVED","IN_TRANSIT","IN_PROCESS","REJECTED","DISPOSED"].includes(status)
          ? { status: status as "PLANNED" | "COLLECTED" | "RECEIVED" | "IN_TRANSIT" | "IN_PROCESS" | "REJECTED" | "DISPOSED" }
          : {}),
        ...(q ? {
          AND: [{
            OR: [
              { barcode: { contains: q } },
              { order: { accessionNumber: { contains: q } } },
              { order: { patient: { patientNumber: { contains: q } } } },
              { order: { patient: { fullNameEn: { contains: q } } } },
              { order: { patient: { phone: { contains: q } } } },
            ],
          }],
        } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        specimenType: true,
        container: true,
        currentBranch: true,
        collectionBranch: true,
        collectedBy: true,
        receivedBy: true,
        rejectedBy: true,
        orderItems: { include: { orderItem: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 5, include: { actor: true, branch: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.branch.findMany({
      where: { id: { in: branchIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const planned = specimens.filter(item => item.status === "PLANNED").length;
  const collected = specimens.filter(item => item.status === "COLLECTED").length;
  const received = specimens.filter(item => ["RECEIVED","IN_PROCESS"].includes(item.status)).length;
  const rejected = specimens.filter(item => item.status === "REJECTED").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Pre-Analytical Workflow", "مرحلة ما قبل التحليل")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="specimen" size={25} />{tr(locale, "Specimens & Barcodes", "العينات والباركود")}</h1>
        <p className="muted">{tr(locale, "Trace each specimen from planned collection through receipt, rejection and recollection using organization-unique barcodes.", "تتبع كل عينة من التخطيط للجمع حتى الاستلام والرفض وإعادة السحب باستخدام باركود فريد على مستوى المؤسسة.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/orders"><SystemIcon name="orders" size={15} />{tr(locale, "Orders", "الطلبات")}</Link>
        <Link className="secondary-link" href="/transfers"><SystemIcon name="transfer" size={15} />{tr(locale, "Transfers", "النقل بين الفروع")}</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Planned", "مخطط")}</span><strong>{planned}</strong><small>{tr(locale, "awaiting collection", "بانتظار الجمع")}</small></article>
      <article><span>{tr(locale, "Collected", "تم الجمع")}</span><strong>{collected}</strong><small>{tr(locale, "awaiting receipt / routing", "بانتظار الاستلام / التوجيه")}</small></article>
      <article><span>{tr(locale, "Lab ready", "جاهزة للمختبر")}</span><strong>{received}</strong><small>{tr(locale, "received or in process", "مستلمة أو قيد المعالجة")}</small></article>
      <article className={rejected ? "summary-attention" : ""}><span>{tr(locale, "Rejected", "مرفوضة")}</span><strong>{rejected}</strong><small>{tr(locale, "requires attention / recollection", "تتطلب متابعة / إعادة سحب")}</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Specimen Work Queue", "قائمة عمل العينات")}</h2><span>{specimens.length} shown</span></div>
        <form className="inline-search" action="/specimens" method="get">
          <input name="q" defaultValue={q} placeholder={tr(locale, "Scan barcode or search order / patient…", "امسح الباركود أو ابحث بالطلب / المريض…")} autoFocus />
          <select name="status" defaultValue={status}>
            <option value="">{tr(locale, "All statuses", "كل الحالات")}</option>
            <option value="PLANNED">PLANNED</option>
            <option value="COLLECTED">COLLECTED</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="IN_TRANSIT">IN_TRANSIT</option>
            <option value="IN_PROCESS">IN_PROCESS</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Search", "بحث")}</button>
          {(q || status) && <Link className="secondary-link" href="/specimens">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>
    </section>

    <div className="specimen-card-list">
      {specimens.length === 0 ? <section className="detail-card"><p className="empty-state">{tr(locale, "No matching specimens.", "لا توجد عينات مطابقة.")}</p></section> :
        specimens.map(specimen => <section className="detail-card specimen-card" key={specimen.id}>
          <div className="specimen-card-head">
            <div>
              <span className={"status-badge status-" + specimen.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, specimen.status)}</span>
              <h2 className="barcode-text">{specimen.barcode}</h2>
              <p className="muted">{specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {specimen.order.patient.fullNameEn}</p>
            </div>
            <Link className="secondary-link" href={`/orders/${specimen.orderId}`}><SystemIcon name="orders" size={15} />{tr(locale, "Open Order", "فتح الطلب")}</Link>
          </div>

          <div className="specimen-metadata">
            <div><span>{tr(locale, "Specimen", "العينة")}</span><strong>{specimen.specimenType?.nameEn || tr(locale, "Not configured", "غير مهيأة")}</strong></div>
            <div><span>{tr(locale, "Container", "الحاوية")}</span><strong>{specimen.container?.nameEn || "—"}</strong></div>
            <div><span>{tr(locale, "Order branch", "فرع الطلب")}</span><strong>{specimen.order.orderingBranch.nameEn}</strong></div>
            <div><span>{tr(locale, "Current branch", "الفرع الحالي")}</span><strong>{specimen.currentBranch?.nameEn || "—"}</strong></div>
            <div><span>{tr(locale, "Linked tests", "الفحوصات المرتبطة")}</span><strong>{specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
            <div><span>{tr(locale, "Collected", "تم الجمع")}</span><strong>{specimen.collectedAt ? specimen.collectedAt.toISOString().replace("T"," ").slice(0,19) : "—"}</strong></div>
            <div><span>{tr(locale, "Received", "تم الاستلام")}</span><strong>{specimen.receivedAt ? specimen.receivedAt.toISOString().replace("T"," ").slice(0,19) : "—"}</strong></div>
            <div><span>{tr(locale, "Volume", "الحجم")}</span><strong>{specimen.volume ? `${specimen.volume.toString()} ${specimen.volumeUnit || ""}` : "—"}</strong></div>
          </div>

          {specimen.status === "REJECTED" && <div className="specimen-rejection">
            <strong>{specimen.rejectionReasonCode}</strong>
            <span>{specimen.rejectionReasonText}</span>
          </div>}

          <SpecimenActions
            specimenId={specimen.id}
            barcode={specimen.barcode}
            status={specimen.status}
            specimenTypeConfigured={Boolean(specimen.specimenTypeId)}
            branches={branches}
            activeBranchId={session.activeBranchId}
          />

          <details className="specimen-history">
            <summary>{tr(locale, "Chain of custody", "سلسلة الحيازة")} ({specimen.events.length} {tr(locale, "recent events", "أحداث حديثة")})</summary>
            <div className="summary-list">
              {specimen.events.map(event => <div key={event.id}>
                <span>{event.occurredAt.toISOString().replace("T"," ").slice(0,19)} · {event.branch?.code || "—"} · {event.actor?.displayNameEn || "System"}</span>
                <strong>{event.eventType}{event.fromStatus || event.toStatus ? ` · ${event.fromStatus || "NEW"} → ${event.toStatus || "—"}` : ""}</strong>
              </div>)}
            </div>
          </details>
        </section>)
      }
    </div>
  </main>;
}
