import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentCreateModal } from "@/components/payment-create-modal";
import { SystemIcon } from "@/components/system-icon";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requirePermission("billing.view");

  const accessibleBranchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [invoices, recentPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: accessibleBranchIds } },
      include: {
        order: { include: { patient: true } },
        client: true,
        branch: true,
      },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    prisma.payment.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: accessibleBranchIds } },
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
  const totals = new Map<string, { invoiced: number; paid: number; balance: number }>();
  for (const invoice of invoices) {
    if (invoice.status === "VOID") continue;
    const row = totals.get(invoice.currency) || { invoiced: 0, paid: 0, balance: 0 };
    row.invoiced += invoice.total.toNumber();
    row.paid += invoice.paidAmount.toNumber();
    row.balance += invoice.balanceAmount.toNumber();
    totals.set(invoice.currency, row);
  }

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Billing</p>
        <h1 className="page-title-with-icon"><SystemIcon name="billing" size={25} />Invoices & Payments</h1>
        <p className="muted">Historical invoice values are stored as immutable snapshots. Payments are allocated separately and support partial settlement.</p>
      </div>
      <div className="header-actions">
        <PaymentCreateModal invoices={openInvoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          balanceAmount: invoice.balanceAmount.toString(),
        }))} />
        <Link className="secondary-link" href="/orders"><SystemIcon name="orders" size={15} />Orders</Link>
        <Link className="secondary-link" href="/pricing"><SystemIcon name="pricing" size={15} />Pricing</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />Back to Dashboard</Link>
      </div>
    </header>

    <section className="finance-kpi-grid">
      {[...totals.entries()].map(([currency, row]) => <article key={currency}>
        <div><span>{currency}</span><small>Current invoice set</small></div>
        <dl>
          <div><dt>Invoiced</dt><dd>{row.invoiced.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
          <div><dt>Paid</dt><dd>{row.paid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
          <div><dt>Outstanding</dt><dd className={row.balance > 0 ? "finance-due" : ""}>{row.balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
        </dl>
      </article>)}
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
                <td><span className={"status-badge status-" + invoice.status.toLowerCase().replaceAll("_","-")}>{invoice.status}</span></td>
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
                <td><span className={"status-badge status-" + payment.status.toLowerCase().replaceAll("_","-")}>{payment.status}</span></td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
