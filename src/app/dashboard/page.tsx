import Link from "next/link";
import { SystemIcon, type SystemIconName } from "@/components/system-icon";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const user = session.user;
  const branch = session.activeBranch;
  const locale = getUiLocale(user.preferredLocale);
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
    branchId && permissions.has("billing.view") ? prisma.invoice.findMany({
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
    permissions.has("orders.create") ? { href: "/orders", label: tr(locale, "New Order", "طلب جديد"), description: tr(locale, "Register patient tests and billing", "تسجيل فحوصات المريض والفوترة"), icon: "orders" } : null,
    permissions.has("specimens.view") ? { href: "/specimens", label: tr(locale, "Specimen Desk", "مكتب العينات"), description: tr(locale, "Collect, receive and trace samples", "جمع العينات واستلامها وتتبعها"), icon: "specimen" } : null,
    permissions.has("worklists.view") ? { href: "/worklists", label: tr(locale, "Worklists", "قوائم العمل"), description: tr(locale, "Enter and verify laboratory results", "إدخال النتائج المخبرية والتحقق منها"), icon: "worklist" } : null,
    permissions.has("reports.view") ? { href: "/reports", label: tr(locale, "Reports", "التقارير"), description: tr(locale, "Review released diagnostic reports", "مراجعة التقارير التشخيصية الصادرة"), icon: "report" } : null,
  ];

  const managementLinks: Array<{ href: string; label: string; value: number | string; tone: string; icon: SystemIconName } | null> = [
    permissions.has("critical.communicate") ? { href: "/critical-results", label: tr(locale, "Critical Results", "النتائج الحرجة"), value: openCritical, tone: openCritical > 0 ? "danger" : "neutral", icon: "critical" } : null,
    permissions.has("qc.view") ? { href: "/qc", label: tr(locale, "Quality Control", "ضبط الجودة"), value: "QC", tone: "neutral", icon: "qc" } : null,
    permissions.has("quality.view") ? { href: "/quality", label: tr(locale, "Quality Management", "إدارة الجودة"), value: "QMS", tone: "neutral", icon: "quality" } : null,
    permissions.has("analytics.view") ? { href: "/analytics", label: tr(locale, "Management Analytics", "التحليلات الإدارية"), value: "KPI", tone: "neutral", icon: "analytics" } : null,
  ];

  return <main className="dashboard-home">
    <section className="dashboard-hero">
      <div>
        <p className="eyebrow">{tr(locale, "Operational Overview", "نظرة تشغيلية")}</p>
        <h1>{branch?.nameEn || branch?.nameAr || "Family Lab"}</h1>
        <p>{tr(locale, "Welcome back", "مرحبًا بعودتك")}، <strong>{locale === "ar" ? user.displayNameAr || user.displayNameEn : user.displayNameEn || user.displayNameAr}</strong>. {tr(locale, "Here is the current laboratory workload.", "إليك عبء العمل الحالي في المختبر.")}</p>
      </div>
      <div className="dashboard-date">
        <span>{tr(locale, "Today", "اليوم")}</span>
        <strong>{new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</strong>
      </div>
    </section>

    <section className="dashboard-kpis">
      <article><div className="kpi-icon"><SystemIcon name="orders" size={20} /></div><div><span>{tr(locale, "Orders today", "طلبات اليوم")}</span><strong>{todayOrders}</strong><small>{tr(locale, "Registered at this branch", "مسجلة في هذا الفرع")}</small></div></article>
      <article><div className="kpi-icon"><SystemIcon name="specimen" size={20} /></div><div><span>{tr(locale, "Active specimens", "العينات النشطة")}</span><strong>{activeSpecimens}</strong><small>{tr(locale, "Received / in process / transit", "مستلمة / قيد المعالجة / قيد النقل")}</small></div></article>
      <article className={openCritical > 0 ? "kpi-alert" : ""}><div className="kpi-icon"><SystemIcon name="critical" size={20} /></div><div><span>{tr(locale, "Open critical", "نتائج حرجة مفتوحة")}</span><strong>{openCritical}</strong><small>{tr(locale, "Require communication / acknowledgement", "تتطلب تبليغًا / إقرارًا")}</small></div></article>
      <article><div className="kpi-icon"><SystemIcon name="digital" size={20} /></div><div><span>{tr(locale, "Waiting queue", "قائمة الانتظار")}</span><strong>{waitingQueue}</strong><small>{tr(locale, "Reception and phlebotomy", "الاستقبال وسحب الدم")}</small></div></article>
    </section>

    <section className="dashboard-layout">
      <div className="dashboard-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">{tr(locale, "Fast workflow", "إجراءات سريعة")}</p><h2>{tr(locale, "Quick Actions", "إجراءات سريعة")}</h2></div></div>
        <div className="quick-action-grid">
          {quickActions.filter((action): action is NonNullable<typeof action> => Boolean(action)).map(action => <Link href={action.href} className="quick-action" key={action.href}>
            <span><SystemIcon name={action.icon} size={18} /></span>
            <div><strong>{action.label}</strong><small>{action.description}</small></div>
            <b>→</b>
          </Link>)}
        </div>
      </div>

      {permissions.has("billing.view") && <aside className="dashboard-panel">
        <div className="dashboard-panel-head"><div><p className="eyebrow">{tr(locale, "Finance", "المالية")}</p><h2>{tr(locale, "Today", "اليوم")}</h2></div><Link href="/billing">{tr(locale, "Open billing", "فتح الفوترة")}</Link></div>
        <div className="finance-snapshot">
          {finance.size === 0 ? <p className="muted">{tr(locale, "No invoices issued today.", "لا توجد فواتير صادرة اليوم.")}</p> : [...finance.entries()].map(([currency, row]) => <div key={currency}>
            <div><strong>{currency}</strong><span>{row.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
            <small>{tr(locale, "Collected", "المحصّل")} {row.paid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} · {tr(locale, "Outstanding", "المتبقي")} {row.balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</small>
          </div>)}
        </div>
      </aside>}
    </section>

    {managementLinks.some(Boolean) && <section className="dashboard-panel dashboard-management">
      <div className="dashboard-panel-head"><div><p className="eyebrow">{tr(locale, "Management & Quality", "الإدارة والجودة")}</p><h2>{tr(locale, "Attention & Insights", "التنبيهات والمؤشرات")}</h2></div></div>
      <div className="management-links">
        {managementLinks.filter((item): item is NonNullable<typeof item> => Boolean(item)).map(item => <Link href={item.href} className={"management-link " + item.tone} key={item.href}>
          <span><SystemIcon name={item.icon} size={17} />{item.label}</span><strong>{item.value}</strong>
        </Link>)}
      </div>
    </section>}
  </main>;
}
