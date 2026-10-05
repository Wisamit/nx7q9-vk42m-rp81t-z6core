import Link from "next/link";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const permissions = permissionSet(session);
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

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Global Search</p>
        <h1>Find Anything</h1>
        <p className="muted">Search patient identity, phone/MRN, accession, barcode, invoice, referrer and client data within your authorized scope.</p>
      </div>
    </header>

    <form className="global-search-page" action="/search" method="get">
      <input name="q" defaultValue={q} autoFocus placeholder="Patient, phone, MRN, accession, barcode, invoice, doctor/client…" />
      <button className="primary-button">Search</button>
    </form>

    {!q ? <section className="detail-card"><p className="empty-state">Enter a search term to begin.</p></section> :
      <p className="search-result-summary">{total} result(s) across accessible modules for <strong>{q}</strong>.</p>}

    {q && patients.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Patients</h2><span>{patients.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Patient No.</th><th>Name</th><th>Phone</th><th>Identifiers</th><th></th></tr></thead>
        <tbody>{patients.map(patient => <tr key={patient.id}>
          <td><strong>{patient.patientNumber}</strong></td>
          <td>{patient.fullNameEn}{patient.fullNameAr && <><br/><small dir="rtl">{patient.fullNameAr}</small></>}</td>
          <td>{patient.phone || "—"}</td>
          <td>{patient.identifiers.map(item => item.value).join(" · ") || "—"}</td>
          <td><Link className="secondary-link" href={"/patients/"+patient.id}>Open</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && orders.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Orders</h2><span>{orders.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Accession</th><th>Patient</th><th>Branch</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody>{orders.map(order => <tr key={order.id}>
          <td><strong>{order.accessionNumber}</strong></td>
          <td>{order.patient.patientNumber}<br/><small>{order.patient.fullNameEn}</small></td>
          <td>{order.orderingBranch.code}</td>
          <td>{order.orderedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td><span className={"status-badge status-"+order.status.toLowerCase().replaceAll("_","-")}>{order.status}</span></td>
          <td><Link className="secondary-link" href={"/orders/"+order.id}>Open</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && specimens.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Specimens</h2><span>{specimens.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Barcode</th><th>Accession</th><th>Patient</th><th>Location</th><th>Status</th><th></th></tr></thead>
        <tbody>{specimens.map(specimen => <tr key={specimen.id}>
          <td><strong className="barcode-text">{specimen.barcode}</strong></td>
          <td>{specimen.order.accessionNumber}</td>
          <td>{specimen.order.patient.patientNumber}<br/><small>{specimen.order.patient.fullNameEn}</small></td>
          <td>{specimen.currentBranch?.code || "—"}</td>
          <td><span className={"status-badge status-"+specimen.status.toLowerCase().replaceAll("_","-")}>{specimen.status}</span></td>
          <td><Link className="secondary-link" href={"/specimens?q="+encodeURIComponent(specimen.barcode)}>Open</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && invoices.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Invoices</h2><span>{invoices.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Patient / Client</th><th>Branch</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.id}>
          <td><strong>{invoice.invoiceNumber}</strong></td>
          <td>{invoice.client?.nameEn || invoice.order?.patient.fullNameEn || "—"}</td>
          <td>{invoice.branch.code}</td>
          <td>{invoice.total.toString()} {invoice.currency}</td>
          <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
          <td><span className={"status-badge status-"+invoice.status.toLowerCase().replaceAll("_","-")}>{invoice.status}</span></td>
          <td>{invoice.orderId ? <Link className="secondary-link" href={"/orders/"+invoice.orderId}>Open order</Link> : <Link className="secondary-link" href="/billing">Billing</Link>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {q && (referrers.length > 0 || clients.length > 0) && <section className="detail-grid detail-section">
      {referrers.length > 0 && <article className="table-card">
        <div className="table-toolbar"><h2>Referrers</h2><span>{referrers.length}</span></div>
        <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Client</th></tr></thead><tbody>
          {referrers.map(item=><tr key={item.id}><td><strong>{item.code}</strong></td><td>{item.nameEn}{item.nameAr&&<><br/><small dir="rtl">{item.nameAr}</small></>}</td><td>{item.client?.nameEn||"—"}</td></tr>)}
        </tbody></table></div>
      </article>}
      {clients.length > 0 && <article className="table-card">
        <div className="table-toolbar"><h2>Clients</h2><span>{clients.length}</span></div>
        <div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Type</th></tr></thead><tbody>
          {clients.map(item=><tr key={item.id}><td><strong>{item.code}</strong></td><td>{item.nameEn}{item.nameAr&&<><br/><small dir="rtl">{item.nameAr}</small></>}</td><td>{item.type}</td></tr>)}
        </tbody></table></div>
      </article>}
    </section>}

    {q && total === 0 && <section className="detail-card detail-section"><p className="empty-state">No accessible records matched this search.</p></section>}
  </main>;
}
