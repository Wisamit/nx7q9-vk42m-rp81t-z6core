import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { OrganizationThemeOverride } from "@/components/organization-theme-override";
import { getOrganizationSystemSettings } from "@/lib/system-settings";

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

  return <><OrganizationThemeOverride settings={settings} /><main className="catalog-shell">
    <header className="page-header">
      <div>
        {settings.logoDataUrl && <Image className="public-brand-logo" src={settings.logoDataUrl} alt={settings.systemNameEn} width={180} height={80} unoptimized priority />}
        <p className="eyebrow">Queue Display</p>
        <h1>{branch.nameEn}</h1>
        <p className="muted">{branch.nameAr || "Family Lab"} · Current called/serving tickets only</p>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Reception</h2>
        {reception.length === 0 ? <p className="muted">Waiting for next call.</p> : reception.map(ticket => <div key={ticket.id} className="reflex-card">
          <strong style={{ fontSize: "2rem" }}>{ticket.ticketNumber}</strong>
          <span>{ticket.counterLabel || "Reception"}</span>
          <small>{ticket.status}</small>
        </div>)}
      </article>
      <article className="detail-card">
        <h2>Phlebotomy</h2>
        {phlebotomy.length === 0 ? <p className="muted">Waiting for next call.</p> : phlebotomy.map(ticket => <div key={ticket.id} className="reflex-card">
          <strong style={{ fontSize: "2rem" }}>{ticket.ticketNumber}</strong>
          <span>{ticket.counterLabel || "Phlebotomy"}</span>
          <small>{ticket.status}</small>
        </div>)}
      </article>
    </section>

    <p className="muted">This public display intentionally shows no patient names, MRNs, phone numbers or other clinical information.</p>
  </main></>;
}
