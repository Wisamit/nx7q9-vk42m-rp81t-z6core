import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentForm } from "@/components/payment-form";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requirePermission("billing.view");

  const [invoices, recentPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: session.user.organizationId },
      include: {
        order: { include: { patient: true } },
        client: true,
        branch: true,
      },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    prisma.payment.findMany({
      where: { organizationId: session.user.organizationId },
      include: {
        branch: true,
        cashier: true,
        allocations: { include: { invoice: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
  ]);

  const openInvoices = invoices.filter(invoice => invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID");

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Billing</p>
        <h1>Invoices & Payments</h1>
        <p className="muted">Historical invoice values are stored as immutable snapshots. Payments are allocated separately and support partial settlement.</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/orders">Orders</Link>
        <Link className="secondary-link" href="/pricing">Pricing</Link>
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Post Payment</h2>
        <PaymentForm invoices={openInvoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          balanceAmount: invoice.balanceAmount.toString(),
        }))} />
      </article>
      <article className="detail-card">
        <h2>Billing Rules</h2>
        <dl>
          <dt>Money</dt><dd>DECIMAL snapshots</dd>
          <dt>Currency</dt><dd>Explicit per invoice and payment</dd>
          <dt>Partial payment</dt><dd>Supported</dd>
          <dt>Allocation</dt><dd>Payment → invoice allocation</dd>
          <dt>History</dt><dd>Original order and invoice prices retained</dd>
        </dl>
      </article>
    </section>

    <section className="table-card">
      <div className="table-toolbar"><h2>Invoices</h2><span>{invoices.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Invoice</th><th>Order</th><th>Patient / Client</th><th>Branch</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.length === 0 ? <tr><td colSpan={8} className="empty-state">No invoices yet.</td></tr> :
              invoices.map(invoice => <tr key={invoice.id}>
                <td><strong>{invoice.invoiceNumber}</strong><br/><small>{invoice.issuedAt.toISOString().slice(0,16).replace("T"," ")}</small></td>
                <td>{invoice.order?.accessionNumber || "—"}</td>
                <td>{invoice.client?.nameEn || invoice.order?.patient.fullNameEn || "—"}</td>
                <td>{invoice.branch.code}</td>
                <td>{invoice.total.toString()} {invoice.currency}</td>
                <td>{invoice.paidAmount.toString()} {invoice.currency}</td>
                <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
                <td>{invoice.status}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Recent Payments</h2><span>{recentPayments.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Invoice(s)</th><th>Amount</th><th>Method</th><th>Reference</th><th>Cashier</th><th>Status</th></tr></thead>
          <tbody>
            {recentPayments.length === 0 ? <tr><td colSpan={7} className="empty-state">No payments posted yet.</td></tr> :
              recentPayments.map(payment => <tr key={payment.id}>
                <td>{payment.receivedAt.toISOString().slice(0,16).replace("T"," ")}</td>
                <td>{payment.allocations.map(a => a.invoice.invoiceNumber).join(", ") || "—"}</td>
                <td>{payment.amount.toString()} {payment.currency}</td>
                <td>{payment.method}</td>
                <td>{payment.reference || "—"}</td>
                <td>{payment.cashier.displayNameEn}</td>
                <td>{payment.status}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
