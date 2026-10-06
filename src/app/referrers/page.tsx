import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClientReferrerForms } from "@/components/client-referrer-forms";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ReferrersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("referrers.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const query = (await searchParams).q?.trim() || "";
  const permissions = permissionSet(session);

  const [clients, referrers, sources] = await Promise.all([
    prisma.client.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(query ? { OR: [{ code: { contains: query } }, { nameEn: { contains: query } }, { nameAr: { contains: query } }] } : {}),
      },
      orderBy: { nameEn: "asc" },
      take: 100,
    }),
    prisma.referrer.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(query ? { OR: [{ code: { contains: query } }, { nameEn: { contains: query } }, { nameAr: { contains: query } }, { licenseNumber: { contains: query } }] } : {}),
      },
      include: { client: true },
      orderBy: { nameEn: "asc" },
      take: 100,
    }),
    prisma.orderSource.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(query ? { OR: [{ code: { contains: query } }, { category: { contains: query } }, { nameEn: { contains: query } }, { nameAr: { contains: query } }] } : {}),
      },
      orderBy: { nameEn: "asc" },
      take: 100,
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const clientTypeLabel = (value: string) => ({ INDIVIDUAL: tr(locale,"Individual","فرد"), CLINIC: tr(locale,"Clinic","عيادة"), HOSPITAL: tr(locale,"Hospital","مستشفى"), COMPANY: tr(locale,"Company","شركة"), INSURANCE: tr(locale,"Insurance","تأمين"), OTHER: tr(locale,"Other","أخرى") }[value] || value);
  const referrerTypeLabel = (value: string) => ({ PHYSICIAN: tr(locale,"Physician","طبيب"), CLINIC: tr(locale,"Clinic","عيادة"), HOSPITAL: tr(locale,"Hospital","مستشفى"), OTHER: tr(locale,"Other","أخرى") }[value] || value);

  const allClients = query ? await prisma.client.findMany({
    where: { organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true, code: true, nameEn: true },
    orderBy: { nameEn: "asc" },
  }) : clients.map(client => ({ id: client.id, code: client.code, nameEn: client.nameEn }));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Commercial & Referral Master Data", "البيانات التجارية وبيانات الإحالة")}</p>
        <h1>{tr(locale, "Referrers & Clients", "المحيلون والعملاء")}</h1>
        <p className="muted">{tr(locale, "Referrers identify who sent the patient; clients identify the commercial or billing account. They may be linked but remain separate concepts.", "المحيل يحدد الجهة التي أرسلت المريض، بينما العميل يمثل الحساب التجاري أو حساب الفوترة. يمكن ربطهما مع بقاء كل منهما كيانًا مستقلاً.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <ClientReferrerForms locale={locale} clients={allClients} canManageSources={permissions.has("sources.manage")} />

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Search", "بحث")}</h2><span>{clients.length} {tr(locale,"clients","عميل")} · {referrers.length} {tr(locale,"referrers","محيل")} · {sources.length} {tr(locale,"sources","مصدر")}</span></div>
        <form className="inline-search" action="/referrers" method="get">
          <input name="q" defaultValue={query} placeholder={tr(locale, "Code, name, license…", "رمز، اسم، رقم ترخيص…")} />
          <button className="secondary-button">{tr(locale, "Search", "بحث")}</button>
          {query && <Link className="secondary-link" href="/referrers">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>
    </section>

    <section className="detail-grid">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Clients", "العملاء")}</h2><span>{clients.length} {tr(locale,"shown","معروض")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Terms", "الشروط")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
            <tbody>{clients.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No clients.", "لا يوجد عملاء.")}</td></tr> : clients.map(client =>
              <tr key={client.id}><td><strong>{client.code}</strong></td><td>{localizedName(client)}{locale !== "ar" && client.nameAr ? <><br/><small dir="rtl">{client.nameAr}</small></> : null}</td><td>{clientTypeLabel(client.type)}</td><td>{client.paymentTermsDays == null ? "—" : `${client.paymentTermsDays} ${tr(locale, "days", "يوم")}`}</td><td>{statusLabel(locale, client.status)}</td></tr>
            )}</tbody>
          </table>
        </div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Referrers", "المحيلون")}</h2><span>{referrers.length} {tr(locale,"shown","معروض")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "License", "الترخيص")}</th><th>{tr(locale, "Client", "العميل")}</th></tr></thead>
            <tbody>{referrers.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No referrers.", "لا يوجد محيلون.")}</td></tr> : referrers.map(referrer =>
              <tr key={referrer.id}><td><strong>{referrer.code}</strong></td><td>{localizedName(referrer)}{locale !== "ar" && referrer.nameAr ? <><br/><small dir="rtl">{referrer.nameAr}</small></> : null}</td><td>{referrerTypeLabel(referrer.type)}</td><td>{referrer.licenseNumber || "—"}</td><td>{referrer.client?.nameEn || "—"}</td></tr>
            )}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Order Sources", "مصادر الطلبات")}</h2><span>{sources.length} {tr(locale, "shown", "معروض")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Category", "الفئة")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{sources.length === 0 ? <tr><td colSpan={4} className="empty-state">{tr(locale, "No order sources.", "لا توجد مصادر طلبات.")}</td></tr> : sources.map(source =>
          <tr key={source.id}>
            <td><strong>{source.code}</strong></td>
            <td>{localizedName(source)}{locale !== "ar" && source.nameAr ? <><br/><small dir="rtl">{source.nameAr}</small></> : null}</td>
            <td>{source.category}</td>
            <td>{source.status}</td>
          </tr>
        )}</tbody>
      </table></div>
    </section>
  </main>;
}
