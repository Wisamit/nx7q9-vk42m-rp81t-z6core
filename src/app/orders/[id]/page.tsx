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
        include: {
          test: true,
          performedBranch: true,
          priceListItem: { include: { priceList: true } },
          answers: { orderBy: { recordedAt: "asc" } },
          results: { orderBy: { version: "desc" }, take: 1, include: { values: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      invoices: {
        include: { lines: true, allocations: { include: { payment: true } } },
        orderBy: { issuedAt: "desc" },
      },
      statusHistory: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
      specimens: { include: { specimenType: true, container: true, currentBranch: true, orderItems: { include: { orderItem: true } } }, orderBy: { sequenceNumber: "asc" } },
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
          <thead><tr><th>Code snapshot</th><th>Name snapshot</th><th>Unit snapshot</th><th>Performed branch</th><th>Price source</th><th>Price snapshot</th><th>Result</th><th>Status</th></tr></thead>
          <tbody>{order.items.map(item => <tr key={item.id}>
            <td><strong>{item.testCodeSnapshot}</strong></td>
            <td>{item.testNameEnSnapshot}</td>
            <td>{item.unitSnapshot || "—"}</td>
            <td>{item.performedBranch?.nameEn || "—"}</td>
            <td>{item.priceListItem?.priceList.code || "—"}</td>
            <td>{item.finalPriceSnapshot.toString()} {item.currency}</td>
            <td>{item.results[0] ? <Link className="table-link" href={`/worklists/${item.id}`}>{item.results[0].status}{item.results[0].values.some(value => value.isCritical) ? " · CRITICAL" : ""}</Link> : "—"}</td>
            <td>{item.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    {order.items.some(item => item.answers.length > 0) && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Ask-at-Order Answers</h2><span>Historical question snapshots</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Test</th><th>Question</th><th>Answer</th><th>Recorded</th></tr></thead>
        <tbody>{order.items.flatMap(item => item.answers.map(answer => {
          const displayAnswer = answer.answerText
            ?? answer.answerNumeric?.toString()
            ?? (answer.answerBoolean === null ? null : answer.answerBoolean ? "Yes" : "No")
            ?? answer.answerDate?.toISOString().slice(0,10)
            ?? answer.selectedOptionSnapshot
            ?? "—";
          return <tr key={answer.id}>
            <td><strong>{item.testCodeSnapshot}</strong></td>
            <td>{answer.questionTextEnSnapshot}{answer.questionTextArSnapshot && <><br/><small dir="rtl">{answer.questionTextArSnapshot}</small></>}</td>
            <td><strong>{displayAnswer}</strong></td>
            <td>{answer.recordedAt.toISOString().replace("T"," ").slice(0,19)}</td>
          </tr>;
        }))}</tbody>
      </table></div>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Specimens</h2><span>{order.specimens.length} planned / historical</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Barcode</th><th>Specimen</th><th>Container</th><th>Tests</th><th>Current branch</th><th>Status</th></tr></thead>
          <tbody>{order.specimens.length === 0 ? <tr><td colSpan={6} className="empty-state">No specimen plans.</td></tr> : order.specimens.map(specimen => <tr key={specimen.id}>
            <td><Link className="table-link" href={`/specimens?q=${encodeURIComponent(specimen.barcode)}`}><strong>{specimen.barcode}</strong></Link></td>
            <td>{specimen.specimenType?.nameEn || "Not configured"}</td>
            <td>{specimen.container?.nameEn || "—"}</td>
            <td>{specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(", ")}</td>
            <td>{specimen.currentBranch?.nameEn || "—"}</td>
            <td>{specimen.status}</td>
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
