import Link from "next/link";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const user = session.user;
  const branch = session.activeBranch;
  const branchId = branch?.id || session.user.branchScopes.find(scope => scope.branch.status === "ACTIVE")?.branchId || null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [todayOrders, activeSpecimens, openCritical, waitingQueue, todayInvoices] = branchId ? await Promise.all([
    prisma.labOrder.count({
      where: {
        organizationId: user.organizationId,
        orderingBranchId: branchId,
        orderedAt: { gte: todayStart, lte: todayEnd },
        status: { not: "CANCELLED" },
      },
    }),
    prisma.specimen.count({
      where: {
        organizationId: user.organizationId,
        currentBranchId: branchId,
        status: { in: ["RECEIVED", "IN_PROCESS", "IN_TRANSIT"] },
      },
    }),
    prisma.criticalResultEvent.count({
      where: {
        status: "OPEN",
        result: {
          organizationId: user.organizationId,
          performingBranchId: branchId,
        },
      },
    }),
    prisma.queueTicket.count({
      where: {
        organizationId: user.organizationId,
        branchId,
        queueDate: todayStart,
        status: "WAITING",
      },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: user.organizationId,
        branchId,
        issuedAt: { gte: todayStart, lte: todayEnd },
        status: { not: "VOID" },
      },
      select: { currency: true, total: true, paidAmount: true, balanceAmount: true },
      take: 5000,
    }),
  ]) : [0, 0, 0, 0, []];

  const finance = new Map<string, { total: number; paid: number; balance: number }>();
  for (const invoice of todayInvoices) {
    const row = finance.get(invoice.currency) || { total: 0, paid: 0, balance: 0 };
    row.total += invoice.total.toNumber();
    row.paid += invoice.paidAmount.toNumber();
    row.balance += invoice.balanceAmount.toNumber();
    finance.set(invoice.currency, row);
  }

  const quickActions = [
    permissions.has("orders.create") ? { href: "/orders", label: "New Order", description: "Register patient tests and billing", key: "OR" } : null,
    permissions.has("specimens.view") ? { href: "/specimens", label: "Specimen Desk", description: "Collect, receive and trace samples", key: "SP" } : null,
    permissions.has("worklists.view") ? { href: "/worklists", label: "Worklists", description: "Enter and verify laboratory results", key: "WL" } : null,
    permissions.has("reports.view") ? { href: "/reports", label: "Reports", description: "Review released diagnostic reports", key: "RP" } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const managementLinks = [
    permissions.has("critical.communicate") ? { href: "/critical-results", label: "Critical Results", value: openCritical, tone: openCritical > 0 ? "danger" : "neutral" } : null,
    permissions.has("qc.view") ? { href: "/qc", label: "Quality Control", value: "QC", tone: "neutral" } : null,
    permissions.has("quality.view") ? { href: "/quality", label: "Quality Management", value: "QMS", tone: "neutral" } : null,
    permissions.has("analytics.view") ? { href: "/analytics", label: "Management Analytics", value: "KPI", tone: "neutral" } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return <main className="dashboard-home">
    <section className="dashboard-hero">
      <div>
        <p className="eyebrow">Operational Overview</p>
        <h1>{branch?.nameEn || branch?.nameAr || "Family Lab"}</h1>
        <p>Welcome back, <strong>{user.displayNameEn || user.displayNameAr}</strong>. Here is the current laboratory workload.</p>
      </div>
      <div className="dashboard-date">
        <span>Today</span>
        <strong>{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</strong>
      </div>
    </section>

    <section className="dashboard-kpis">
      <article><div className="kpi-icon">OR</div><div><span>Orders today</span><strong>{todayOrders}</strong><small>Registered at this branch</small></div></article>
      <article><div className="kpi-icon">SP</div><div><span>Active specimens</span><strong>{activeSpecimens}</strong><small>Received / in process / transit</small></div></article>
      <article className={openCritical > 0 ? "kpi-alert" : ""}><div className="kpi-icon">CR</div><div><span>Open critical</span><strong>{openCritical}</strong><small>Require communication / acknowledgement</small></div></article>
      <article><div className="kpi-icon">QU</div><div><span>Waiting queue</span><strong>{waitingQueue}</strong><small>Reception and phlebotomy</small></div></article>
    </section>

    <section className="dashboard-layout">
      <div className="dashboard-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">Fast workflow</p><h2>Quick Actions</h2></div></div>
        <div className="quick-action-grid">
          {quickActions.map(action => <Link href={action.href} className="quick-action" key={action.href}>
            <span>{action.key}</span>
            <div><strong>{action.label}</strong><small>{action.description}</small></div>
            <b>→</b>
          </Link>)}
        </div>
      </div>

      <aside className="dashboard-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">Finance</p><h2>Today</h2></div>{permissions.has("billing.view") && <Link href="/billing">Open billing</Link>}</div>
        <div className="finance-snapshot">
          {finance.size === 0 ? <p className="muted">No invoices issued today.</p> : [...finance.entries()].map(([currency, row]) => <div key={currency}>
            <div><strong>{currency}</strong><span>{row.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            <small>Collected {row.paid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} · Outstanding {row.balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</small>
          </div>)}
        </div>
      </aside>
    </section>

    {managementLinks.length > 0 && <section className="dashboard-panel dashboard-management">
      <div className="dashboard-panel-head"><div><p className="eyebrow">Management & Quality</p><h2>Attention & Insights</h2></div></div>
      <div className="management-links">
        {managementLinks.map(item => <Link href={item.href} className={"management-link " + item.tone} key={item.href}>
          <span>{item.label}</span><strong>{item.value}</strong>
        </Link>)}
      </div>
    </section>}
  </main>;
}
