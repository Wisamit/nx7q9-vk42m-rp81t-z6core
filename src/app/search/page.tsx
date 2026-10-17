import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const q = (await searchParams).q?.trim().slice(0, 120) || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const orgId = session.user.organizationId;

  const [patients, orders, specimens, invoices, referrers, clients] = q ? await Promise.all([
    permissions.has("patients.view") ? prisma.patient.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { patientNumber: { contains: q } },
          { fullNameEn: { contains: q } },
          { fullNameAr: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
          { identifiers: { some: { value: { contains: q }, status: "ACTIVE" } } },
        ],
      },
      include: { identifiers: { where: { status: "ACTIVE" }, take: 3 } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }) : Promise.resolve([]),
    permissions.has("orders.view") ? prisma.labOrder.findMany({
      where: {
        organizationId: orgId,
        orderingBranchId: { in: branchIds },
        OR: [
          { accessionNumber: { contains: q } },
          { patient: { patientNumber: { contains: q } } },
          { patient: { fullNameEn: { contains: q } } },
          { patient: { fullNameAr: { contains: q } } },
          { patient: { phone: { contains: q } } },
        ],
      },
      include: { patient: true, orderingBranch: true },
      orderBy: { orderedAt: "desc" },
      take: 20,
    }) : Promise.resolve([]),
    permissions.has("specimens.view") ? prisma.specimen.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { currentBranchId: { in: branchIds } },
          { order: { orderingBranchId: { in: branchIds } } },
        ],
        AND: [{
          OR: [
            { barcode: { contains: q } },
            { order: { accessionNumber: { contains: q } } },
            { order: { patient: { patientNumber: { contains: q } } } },
            { order: { patient: { fullNameEn: { contains: q } } } },
            { order: { patient: { fullNameAr: { contains: q } } } },
          ],
        }],
      },
      include: { order: { include: { patient: true } }, currentBranch: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }) : Promise.resolve([]),
    permissions.has("billing.view") ? prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        branchId: { in: branchIds },
        OR: [
          { invoiceNumber: { contains: q } },
          { order: { accessionNumber: { contains: q } } },
          { order: { patient: { patientNumber: { contains: q } } } },
          { order: { patient: { fullNameEn: { contains: q } } } },
          { client: { code: { contains: q } } },
          { client: { nameEn: { contains: q } } },
          { client: { nameAr: { contains: q } } },
        ],
      },
      include: { order: { include: { patient: true } }, client: true, branch: true },
      orderBy: { issuedAt: "desc" },
      take: 20,
    }) : Promise.resolve([]),
    permissions.has("referrers.view") ? prisma.referrer.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { code: { contains: q } },
          { nameEn: { contains: q } },
          { nameAr: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
          { licenseNumber: { contains: q } },
        ],
      },
      include: { client: true },
      orderBy: { nameEn: "asc" },
      take: 20,
    }) : Promise.resolve([]),
    permissions.has("referrers.view") ? prisma.client.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { code: { contains: q } },
          { nameEn: { contains: q } },
          { nameAr: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      },
      orderBy: { nameEn: "asc" },
      take: 20,
    }) : Promise.resolve([]),
  ]) : [[], [], [], [], [], []];

  const total = patients.length + orders.length + specimens.length + invoices.length + referrers.length + clients.length;
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) =>
    locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const namedEntity = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const clientTypeLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      CORPORATE: ["Corporate", "شركة"],
      INSURANCE: ["Insurance", "تأمين"],
      HOSPITAL: ["Hospital", "مستشفى"],
      CLINIC: ["Clinic", "عيادة"],
      GOVERNMENT: ["Government", "جهة حكومية"],
      OTHER: ["Other", "أخرى"],
    };
    const label = labels[value];
    return label ? tr(locale, label[0], label[1]) : value;
  };

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Global Search", "البحث الشامل")}</p>
        <h1>{tr(locale, "Find Anything", "ابحث في النظام")}</h1>
        <p className="muted">{tr(locale, "Search patient identity, phone/MRN, accession, barcode, invoice, referrer and client data within your authorized scope.", "ابحث ضمن نطاق صلاحياتك عن هوية المريض أو الهاتف/MRN أو رقم الطلب أو الباركود أو الفاتورة أو المحيل أو العميل.")}</p>
      </div>
    </header>

    <form className="global-search-page" action="/search" method="get">
      <input name="q" defaultValue={q} autoFocus placeholder={tr(locale, "Patient, phone, MRN, accession, barcode, invoice, doctor/client…", "مريض، هاتف، MRN، رقم طلب، باركود، فاتورة، طبيب/عميل…")} />
      <button className="primary-button">{tr(locale, "Search", "بحث")}</button>
    </form>

    {!q ? <section className="detail-card"><p className="empty-state">{tr(locale, "Enter a search term to begin.", "أدخل عبارة للبحث للبدء.")}</p></section> :
      <p className="search-result-summary">{total} {tr(locale, "result(s) across accessible modules for", "نتيجة ضمن الوحدات المتاحة للبحث عن")} <strong>{q}</strong>.</p>}

    {q && patients.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Patients", "المرضى")}</h2><span>{patients.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Patient No.", "رقم المريض")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Phone", "الهاتف")}</th><th>{tr(locale, "Identifiers", "المعرفات")}</th><th></th></tr></thead>
        <tbody>{patients.map(patient => <tr key={patient.id}>
          <td><strong>{patient.patientNumber}</strong></td>
          <td>{patientName(patient)}{locale !== "ar" && patient.fullNameAr && <><br/><small dir="rtl">{patient.fullNameAr}</small></>}</td>
          <td>{patient.phone || "—"}</td>
          <td>{patient.identifiers.map(item => item.value).join(" · ") || "—"}</td>
          <td><Link className="secondary-link" href={"/patients/"+patient.id}>{tr(locale, "Open", "فتح")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && orders.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Orders", "الطلبات")}</h2><span>{orders.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Date", "التاريخ")}</th><th>{tr(locale, "Status", "الحالة")}</th><th></th></tr></thead>
        <tbody>{orders.map(order => <tr key={order.id}>
          <td><strong>{order.accessionNumber}</strong></td>
          <td>{order.patient.patientNumber}<br/><small>{patientName(order.patient)}</small></td>
          <td>{order.orderingBranch.code}</td>
          <td>{<SystemDateText value={order.orderedAt.toISOString()} />}</td>
          <td><span className={"status-badge status-"+order.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, order.status)}</span></td>
          <td><Link className="secondary-link" href={"/orders/"+order.id}>{tr(locale, "Open", "فتح")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && specimens.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Specimens", "العينات")}</h2><span>{specimens.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Barcode", "الباركود")}</th><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Location", "الموقع")}</th><th>{tr(locale, "Status", "الحالة")}</th><th></th></tr></thead>
        <tbody>{specimens.map(specimen => <tr key={specimen.id}>
          <td><strong className="barcode-text">{specimen.barcode}</strong></td>
          <td>{specimen.order.accessionNumber}</td>
          <td>{specimen.order.patient.patientNumber}<br/><small>{patientName(specimen.order.patient)}</small></td>
          <td>{specimen.currentBranch?.code || "—"}</td>
          <td><span className={"status-badge status-"+specimen.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, specimen.status)}</span></td>
          <td><Link className="secondary-link" href={"/specimens?q="+encodeURIComponent(specimen.barcode)}>{tr(locale, "Open", "فتح")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && invoices.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Invoices", "الفواتير")}</h2><span>{invoices.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Patient / Client", "المريض / العميل")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Total", "الإجمالي")}</th><th>{tr(locale, "Balance", "الرصيد")}</th><th>{tr(locale, "Status", "الحالة")}</th><th></th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.id}>
          <td><strong>{invoice.invoiceNumber}</strong></td>
          <td>{invoice.client ? namedEntity(invoice.client) : invoice.order?.patient ? patientName(invoice.order.patient) : "—"}</td>
          <td>{invoice.branch.code}</td>
          <td>{invoice.total.toString()} {invoice.currency}</td>
          <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
          <td><span className={"status-badge status-"+invoice.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, invoice.status)}</span></td>
          <td>{invoice.orderId ? <Link className="secondary-link" href={"/orders/"+invoice.orderId}>{tr(locale, "Open order", "فتح الطلب")}</Link> : <Link className="secondary-link" href="/billing">{tr(locale, "Billing", "الفوترة")}</Link>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && (referrers.length > 0 || clients.length > 0) && <section className="detail-grid detail-section">
      {referrers.length > 0 && <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Referrers", "المحيلون")}</h2><span>{referrers.length}</span></div>
        <div className="table-wrap"><table><thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Client", "العميل")}</th></tr></thead><tbody>
          {referrers.map(item=><tr key={item.id}><td><strong>{item.code}</strong></td><td>{namedEntity(item)}{locale !== "ar" && item.nameAr&&<><br/><small dir="rtl">{item.nameAr}</small></>}</td><td>{item.client ? namedEntity(item.client) : "—"}</td></tr>)}
        </tbody></table></div>
      </article>}
      {clients.length > 0 && <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Clients", "العملاء")}</h2><span>{clients.length}</span></div>
        <div className="table-wrap"><table><thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Type", "النوع")}</th></tr></thead><tbody>
          {clients.map(item=><tr key={item.id}><td><strong>{item.code}</strong></td><td>{namedEntity(item)}{locale !== "ar" && item.nameAr&&<><br/><small dir="rtl">{item.nameAr}</small></>}</td><td>{clientTypeLabel(item.type)}</td></tr>)}
        </tbody></table></div>
      </article>}
    </section>}

    {q && total === 0 && <section className="detail-card detail-section"><p className="empty-state">{tr(locale, "No accessible records matched this search.", "لا توجد سجلات متاحة تطابق هذا البحث.")}</p></section>}
  </main>;
}
