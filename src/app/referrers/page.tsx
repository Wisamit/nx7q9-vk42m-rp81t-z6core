import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClientReferrerForms } from "@/components/client-referrer-forms";

export const dynamic = "force-dynamic";

export default async function ReferrersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("referrers.view");
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

  const allClients = query ? await prisma.client.findMany({
    where: { organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true, code: true, nameEn: true },
    orderBy: { nameEn: "asc" },
  }) : clients.map(client => ({ id: client.id, code: client.code, nameEn: client.nameEn }));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Commercial & Referral Master Data</p>
        <h1>Referrers & Clients</h1>
        <p className="muted">Referrers identify who sent the patient; clients identify the commercial or billing account. They may be linked but remain separate concepts.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <ClientReferrerForms clients={allClients} canManageSources={permissions.has("sources.manage")} />

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>Search</h2><span>{clients.length} clients · {referrers.length} referrers · {sources.length} sources</span></div>
        <form className="inline-search" action="/referrers" method="get">
          <input name="q" defaultValue={query} placeholder="Code, name, license…" />
          <button className="secondary-button">Search</button>
          {query && <Link className="secondary-link" href="/referrers">Clear</Link>}
        </form>
      </div>
    </section>

    <section className="detail-grid">
      <article className="table-card">
        <div className="table-toolbar"><h2>Clients</h2><span>{clients.length} shown</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Terms</th><th>Status</th></tr></thead>
            <tbody>{clients.length === 0 ? <tr><td colSpan={5} className="empty-state">No clients.</td></tr> : clients.map(client =>
              <tr key={client.id}><td><strong>{client.code}</strong></td><td>{client.nameEn}{client.nameAr ? <><br/><small dir="rtl">{client.nameAr}</small></> : null}</td><td>{client.type}</td><td>{client.paymentTermsDays == null ? "—" : `${client.paymentTermsDays} days`}</td><td>{client.status}</td></tr>
            )}</tbody>
          </table>
        </div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Referrers</h2><span>{referrers.length} shown</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>License</th><th>Client</th></tr></thead>
            <tbody>{referrers.length === 0 ? <tr><td colSpan={5} className="empty-state">No referrers.</td></tr> : referrers.map(referrer =>
              <tr key={referrer.id}><td><strong>{referrer.code}</strong></td><td>{referrer.nameEn}{referrer.nameAr ? <><br/><small dir="rtl">{referrer.nameAr}</small></> : null}</td><td>{referrer.type}</td><td>{referrer.licenseNumber || "—"}</td><td>{referrer.client?.nameEn || "—"}</td></tr>
            )}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Order Sources</h2><span>{sources.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th></tr></thead>
        <tbody>{sources.length === 0 ? <tr><td colSpan={4} className="empty-state">No order sources.</td></tr> : sources.map(source =>
          <tr key={source.id}>
            <td><strong>{source.code}</strong></td>
            <td>{source.nameEn}{source.nameAr ? <><br/><small dir="rtl">{source.nameAr}</small></> : null}</td>
            <td>{source.category}</td>
            <td>{source.status}</td>
          </tr>
        )}</tbody>
      </table></div>
    </section>
  </main>;
}
