import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { OrganizationThemeOverride } from "@/components/organization-theme-override";
import { SystemDateText } from "@/components/system-date-text";
import { getOrganizationSystemSettings } from "@/lib/system-settings";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

function branchLocalDate(timezone: string, value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

export default async function QueueDisplayPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, status: "ACTIVE" },
    select: { id: true, organizationId: true, nameEn: true, nameAr: true, timezone: true },
  });
  if (!branch) notFound();
  const settings = await getOrganizationSystemSettings(branch.organizationId);
  const locale = settings.defaultLocale;
  const branchName = locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;

  const queueDate = branchLocalDate(branch.timezone);
  const tickets = await prisma.queueTicket.findMany({
    where: {
      branchId,
      queueDate,
      status: { in: ["CALLED","SERVING"] },
    },
    select: {
      id: true,
      ticketNumber: true,
      stage: true,
      status: true,
      counterLabel: true,
      calledAt: true,
    },
    orderBy: [{ stage: "asc" }, { calledAt: "desc" }],
    take: 20,
  });

  const reception = tickets.filter(ticket => ticket.stage === "RECEPTION");
  const phlebotomy = tickets.filter(ticket => ticket.stage === "PHLEBOTOMY");

  return <><OrganizationThemeOverride settings={settings} /><main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header className="page-header">
      <div>
        {settings.logoDataUrl && <Image className="public-brand-logo" src={settings.logoDataUrl} alt={settings.systemNameEn} width={180} height={80} unoptimized priority />}
        <p className="eyebrow">{tr(locale, "Queue Display", "شاشة الانتظار")}</p>
        <h1>{branchName}</h1>
        <p className="muted">{tr(locale, "Queue date", "تاريخ الانتظار")}: <SystemDateText kind="calendar" value={queueDate.toISOString().slice(0, 10)} /></p>
        <p className="muted">{locale === "ar" ? branch.nameEn : branch.nameAr || settings.systemNameAr} · {tr(locale, "Current called/serving tickets only", "التذاكر المناداة أو قيد الخدمة حاليًا فقط")}</p>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Reception", "الاستقبال")}</h2>
        {reception.length === 0 ? <p className="muted">{tr(locale, "Waiting for next call.", "بانتظار النداء التالي.")}</p> : reception.map(ticket => <div key={ticket.id} className="reflex-card">
          <strong style={{ fontSize: "2rem" }}>{ticket.ticketNumber}</strong>
          <span>{ticket.counterLabel || tr(locale, "Reception", "الاستقبال")}</span>
          <small>{ticket.status}</small>
        </div>)}
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Phlebotomy", "سحب العينات")}</h2>
        {phlebotomy.length === 0 ? <p className="muted">{tr(locale, "Waiting for next call.", "بانتظار النداء التالي.")}</p> : phlebotomy.map(ticket => <div key={ticket.id} className="reflex-card">
          <strong style={{ fontSize: "2rem" }}>{ticket.ticketNumber}</strong>
          <span>{ticket.counterLabel || tr(locale, "Phlebotomy", "سحب العينات")}</span>
          <small>{ticket.status}</small>
        </div>)}
      </article>
    </section>

    <p className="muted">{tr(locale, "This public display intentionally shows no patient names, MRNs, phone numbers or other clinical information.", "لا تعرض هذه الشاشة العامة أسماء المرضى أو أرقامهم الطبية أو أرقام الهواتف أو أي معلومات سريرية أخرى حفاظًا على الخصوصية.")}</p>
  </main></>;
}
