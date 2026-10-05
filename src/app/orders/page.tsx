import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OrderCreateForm } from "@/components/order-create-form";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await requirePermission("orders.view");

  const [patients, tests, clients, referrers, branches, orders] = await Promise.all([
    prisma.patient.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, patientNumber: true, fullNameEn: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.referrer.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, clientId: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branch.findMany({
      where: {
        id: { in: session.user.branchScopes.map(scope => scope.branchId) },
        organizationId: session.user.organizationId,
        status: "ACTIVE",
      },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labOrder.findMany({
      where: { organizationId: session.user.organizationId },
      include: {
        patient: true,
        orderingBranch: true,
        client: true,
        referrer: true,
        items: true,
        invoices: { orderBy: { issuedAt: "desc" }, take: 1 },
      },
      orderBy: { orderedAt: "desc" },
      take: 100,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Order Entry</p>
        <h1>Orders</h1>
        <p className="muted">Register laboratory orders with branch, patient, referral source and effective-dated price snapshots.</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/pricing">Pricing</Link>
        <Link className="secondary-link" href="/billing">Billing</Link>
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-card">
      <h2>New Order</h2>
      <OrderCreateForm
        patients={patients}
        tests={tests}
        clients={clients}
        referrers={referrers}
        branches={branches}
        activeBranchId={session.activeBranchId}
      />
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Recent Orders</h2><span>{orders.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Accession</th><th>Patient</th><th>Branch</th><th>Priority</th><th>Tests</th><th>Client / Referrer</th><th>Invoice</th><th>Status</th></tr></thead>
          <tbody>
            {orders.length === 0 ? <tr><td colSpan={8} className="empty-state">No orders registered yet.</td></tr> :
              orders.map(order => {
                const invoice = order.invoices[0];
                return <tr key={order.id}>
                  <td><strong>{order.accessionNumber}</strong><br/><small>{order.orderedAt.toISOString().slice(0,16).replace("T"," ")}</small></td>
                  <td>{order.patient.patientNumber}<br/><small>{order.patient.fullNameEn}</small></td>
                  <td>{order.orderingBranch.code}</td>
                  <td>{order.priority}</td>
                  <td>{order.items.length}</td>
                  <td>{order.client?.nameEn || order.referrer?.nameEn || "Patient / walk-in"}</td>
                  <td>{invoice ? <>{invoice.invoiceNumber}<br/><small>{invoice.total.toString()} {invoice.currency}</small></> : "—"}</td>
                  <td>{order.status}</td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
