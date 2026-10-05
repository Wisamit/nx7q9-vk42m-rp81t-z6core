import Link from "next/link";
import { SystemIcon, type SystemIconName } from "@/components/system-icon";
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

  const [todayOrders, activeSpecimens, openCritical, waitingQueue, todayInvoices] = await Promise.all([
    branchId ? prisma.labOrder.count({
      where: {
        organizationId: user.organizationId,
        orderingBranchId: branchId,
        orderedAt: { gte: todayStart, lte: todayEnd },
        status: { not: "CANCELLED" },
      },
    }) : Promise.resolve(0),
    branchId ? prisma.specimen.count({
      where: {
        organizationId: user.organizationId,
        currentBranchId: branchId,
        status: { in: ["RECEIVED", "IN_PROCESS", "IN_TRANSIT"] },
      },
    }) : Promise.resolve(0),
    branchId ? prisma.criticalResultEvent.count({
      where: {
        status: "OPEN",
        result: {
          organizationId: user.organizationId,
          performingBranchId: branchId,
        },
      },
    }) : Promise.resolve(0),
    branchId ? prisma.queueTicket.count({
      where: {
        organizationId: user.organizationId,
        branchId,
        queueDate: todayStart,
        status: "WAITING",
      },
    }) : Promise.resolve(0),
    branchId ? prisma.invoice.findMany({
      where: {
        organizationId: user.organizationId,
        branchId,
        issuedAt: { gte: todayStart, lte: todayEnd },
        status: { not: "VOID" },
      },
      select: { currency: true, total: true, paidAmount: true, balanceAmount: true },
      take: 5000,
    }) : Promise.resolve([]),
  ]);

  const finance = new Map<string, { total: number; paid: number; balance: number }>();
  for (const invoice of todayInvoices) {
    const row = finance.get(invoice.currency) || { total: 0, paid: 0, balance: 0 };
    row.total += invoice.total.toNumber();
    row.paid += invoice.paidAmount.toNumber();
    row.balance += invoice.balanceAmount.toNumber();
    finance.set(invoice.currency, row);
  }

  const quickActions: Array<{ href: string; label: string; description: string; icon: SystemIconName } | null> = [
    permissions.has("orders.create") ? { href: "/orders", label: "New Order", description: "Register patient tests and billing", icon: "orders" } : null,
    permissions.has("specimens.view") ? { href: "/specimens", label: "Specimen Desk", description: "Collect, receive and trace samples", icon: "specimen" } : null,
    permissions.has("worklists.view") ? { href: "/worklists", label: "Worklists", description: "Enter and verify laboratory results", icon: "worklist" } : null,
    permissions.has("reports.view") ? { href: "/reports", label: "Reports", description: "Review released diagnostic reports", icon: "report" } : null,
  ];

  const managementLinks: Array<{ href: string; label: string; value: number | string; tone: string; icon: SystemIconName } | null> = [
    permissions.has("critical.communicate") ? { href: "/critical-results", label: "Critical Results", value: openCritical, tone: openCritical > 0 ? "danger" : "neutral", icon: "critical" } : null,
    permissions.has("qc.view") ? { href: "/qc", label: "Quality Control", value: "QC", tone: "neutral", icon: "qc" } : null,
    permissions.has("quality.view") ? { href: "/quality", label: "Quality Management", value: "QMS", tone: "neutral", icon: "quality" } : null,
    permissions.has("analytics.view") ? { href: "/analytics", label: "Management Analytics", value: "KPI", tone: "neutral", icon: "analytics" } : null,
  ];

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
      <article><div className="kpi-icon"><SystemIcon name="orders" size={20} /></div><div><span>Orders today</span><strong>{todayOrders}</strong><small>Registered at this branch</small></div></article>
      <article><div className="kpi-icon"><SystemIcon name="specimen" size={20} /></div><div><span>Active specimens</span><strong>{activeSpecimens}</strong><small>Received / in process / transit</small></div></article>
      <article className={openCritical > 0 ? "kpi-alert" : ""}><div className="kpi-icon"><SystemIcon name="critical" size={20} /></div><div><span>Open critical</span><strong>{openCritical}</strong><small>Require communication / acknowledgement</small></div></article>
      <article><div className="kpi-icon"><SystemIcon name="digital" size={20} /></div><div><span>Waiting queue</span><strong>{waitingQueue}</strong><small>Reception and phlebotomy</small></div></article>
    </section>

    <section className="dashboard-layout">
      <div className="dashboard-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">Fast workflow</p><h2>Quick Actions</h2></div></div>
        <div className="quick-action-grid">
          {quickActions.filter((action): action is NonNullable<typeof action> => Boolean(action)).map(action => <Link href={action.href} className="quick-action" key={action.href}>
            <span><SystemIcon name={action.icon} size={18} /></span>
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

    {managementLinks.some(Boolean) && <section className="dashboard-panel dashboard-management">
      <div className="dashboard-panel-head"><div><p className="eyebrow">Management & Quality</p><h2>Attention & Insights</h2></div></div>
      <div className="management-links">
        {managementLinks.filter((item): item is NonNullable<typeof item> => Boolean(item)).map(item => <Link href={item.href} className={"management-link " + item.tone} key={item.href}>
          <span><SystemIcon name={item.icon} size={17} />{item.label}</span><strong>{item.value}</strong>
        </Link>)}
      </div>
    </section>}
  </main>;
}
