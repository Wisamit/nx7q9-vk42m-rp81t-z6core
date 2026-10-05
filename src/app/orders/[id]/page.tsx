import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.view");
  const { id } = await params;

  const order = await prisma.labOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      patient: true,
      orderingBranch: true,
      referrer: true,
      client: true,
      createdBy: true,
      items: {
        include: { test: true, performedBranch: true, priceListItem: { include: { priceList: true } } },
        orderBy: { createdAt: "asc" },
      },
      invoices: {
        include: { lines: true, allocations: { include: { payment: true } } },
        orderBy: { issuedAt: "desc" },
      },
      statusHistory: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
    },
  });

  if (!order || !canAccessBranch(session, order.orderingBranchId)) notFound();

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Order Record</p>
        <h1>{order.accessionNumber}</h1>
        <p className="muted">{order.patient.patientNumber} · {order.patient.fullNameEn} · {order.orderingBranch.nameEn}</p>
      </div>
      <Link className="secondary-link" href="/orders">Back to Orders</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Order Context</h2>
        <dl>
          <dt>Status</dt><dd>{order.status}</dd>
          <dt>Priority</dt><dd>{order.priority}</dd>
          <dt>Ordered</dt><dd>{order.orderedAt.toISOString().replace("T"," ").slice(0,19)}</dd>
          <dt>Referrer</dt><dd>{order.referrer?.nameEn || "—"}</dd>
          <dt>Client</dt><dd>{order.client?.nameEn || "Patient / walk-in"}</dd>
          <dt>Fasting</dt><dd>{order.fasting === null ? "Unknown" : order.fasting ? "Yes" : "No"}</dd>
          <dt>Diagnosis</dt><dd>{order.diagnosis || "—"}</dd>
          <dt>Created by</dt><dd>{order.createdBy.displayNameEn}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>Clinical Notes</h2>
        <p>{order.clinicalNotes || "—"}</p>
        <h3>Pregnancy information</h3>
        <p>{order.pregnancyInfo || "—"}</p>
      </article>
    </section>

    <section className="table-card">
      <div className="table-toolbar"><h2>Ordered Tests</h2><span>{order.items.length} item(s)</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code snapshot</th><th>Name snapshot</th><th>Unit snapshot</th><th>Performed branch</th><th>Price source</th><th>Price snapshot</th><th>Status</th></tr></thead>
          <tbody>{order.items.map(item => <tr key={item.id}>
            <td><strong>{item.testCodeSnapshot}</strong></td>
            <td>{item.testNameEnSnapshot}</td>
            <td>{item.unitSnapshot || "—"}</td>
            <td>{item.performedBranch?.nameEn || "—"}</td>
            <td>{item.priceListItem?.priceList.code || "—"}</td>
            <td>{item.finalPriceSnapshot.toString()} {item.currency}</td>
            <td>{item.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>Invoices</h2>
        {order.invoices.length === 0 ? <p className="muted">No invoices.</p> :
          <div className="summary-list">{order.invoices.map(invoice => <div key={invoice.id}>
            <span>{invoice.invoiceNumber} · {invoice.status}</span>
            <strong>{invoice.total.toString()} {invoice.currency} · Balance {invoice.balanceAmount.toString()}</strong>
          </div>)}</div>}
      </article>
      <article className="detail-card">
        <h2>Status History</h2>
        <div className="summary-list">{order.statusHistory.map(entry => <div key={entry.id}>
          <span>{entry.changedAt.toISOString().replace("T"," ").slice(0,19)} · {entry.changedBy.displayNameEn}</span>
          <strong>{entry.fromStatus || "NEW"} → {entry.toStatus}</strong>
        </div>)}</div>
      </article>
    </section>
  </main>;
}
