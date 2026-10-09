import Link from "next/link";
import { AnalyticsBars } from "@/components/analytics-bars";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";
import { aggregateFinancialReport } from "@/lib/financial-reporting";
import { addCurrencyAmount, moneyText, financialText, comparableMargin, cappedDatasetNames } from "@/lib/analytics-integrity";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function resolvePeriod(params: Record<string, string | string[] | undefined>) {
  const period = first(params.period) || "30d";
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = now;

  if (period === "7d") start = new Date(now.getTime() - 6 * 86_400_000);
  else if (period === "30d") start = new Date(now.getTime() - 29 * 86_400_000);
  else if (period === "90d") start = new Date(now.getTime() - 89 * 86_400_000);
  else if (period === "365d") start = new Date(now.getTime() - 364 * 86_400_000);
  else if (period === "all") {
    start = null;
    end = null;
  } else if (period === "custom") {
    const from = first(params.from);
    const to = first(params.to);
    start = from ? startOfDay(new Date(from + "T00:00:00")) : null;
    end = to ? endOfDay(new Date(to + "T00:00:00")) : now;
    if (start && Number.isNaN(start.getTime())) start = null;
    if (end && Number.isNaN(end.getTime())) end = now;
  } else {
    start = new Date(now.getTime() - 29 * 86_400_000);
  }

  if (start) start = startOfDay(start);
  if (end) end = endOfDay(end);
  return { period, start, end };
}

function dateWhere(start: Date | null, end: Date | null) {
  if (!start && !end) return undefined;
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

function minuteLabel(value: number | null, locale: "ar" | "en") {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 60) return Math.round(value) + (locale === "ar" ? " دقيقة" : " min");
  return (value / 60).toFixed(1) + (locale === "ar" ? " ساعة" : " h");
}

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requirePermission("analytics.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const params = await searchParams;
  const { period, start, end } = resolvePeriod(params);
  const authorizedBranchIds = session.user.branchScopes.map(scope => scope.branchId);
  const requestedBranchId = first(params.branchId) || "";
  const selectedBranchId = requestedBranchId && authorizedBranchIds.includes(requestedBranchId)
    ? requestedBranchId
    : null;
  const branchIds = selectedBranchId ? [selectedBranchId] : authorizedBranchIds;
  const periodWhere = dateWhere(start, end);

  const [
    branches,
    orders,
    invoices,
    payments,
    refunds,
    creditNotes,
    specimens,
    tatItems,
    criticalEvents,
    qcViolations,
    qualityIndicators,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: {
        organizationId: session.user.organizationId,
        id: { in: authorizedBranchIds },
        status: "ACTIVE",
      },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labOrder.findMany({
      where: {
        organizationId: session.user.organizationId,
        orderingBranchId: { in: branchIds },
        ...(periodWhere ? { orderedAt: periodWhere } : {}),
      },
      include: {
        orderingBranch: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        source: { select: { id: true, code: true, nameEn: true, nameAr: true, category: true } },
        referrer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        items: {
          select: {
            id: true,
            testId: true,
            testCodeSnapshot: true,
            testNameEnSnapshot: true,
            testNameArSnapshot: true,
            finalPriceSnapshot: true,
            currency: true,
          },
        },
      },
      orderBy: { orderedAt: "desc" },
      take: 20000,
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        status: { not: "VOID" },
        ...(periodWhere ? { issuedAt: periodWhere } : {}),
      },
      select: {
        id: true,
        branchId: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        paidAmount: true,
        balanceAmount: true,
      },
      take: 20000,
    }),
    prisma.payment.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        status: "POSTED",
        ...(periodWhere ? { receivedAt: periodWhere } : {}),
      },
      select: { branchId: true, currency: true, amount: true, method: true },
      take: 20000,
    }),
    prisma.refund.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        status: "POSTED",
        ...(periodWhere ? { processedAt: periodWhere } : {}),
      },
      select: { currency: true, amount: true },
      take: 20000,
    }),
    prisma.creditNote.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        status: "ISSUED",
        ...(periodWhere ? { issuedAt: periodWhere } : {}),
      },
      select: { currency: true, amount: true },
      take: 20000,
    }),
    prisma.specimen.findMany({
      where: {
        organizationId: session.user.organizationId,
        order: { orderingBranchId: { in: branchIds } },
        ...(periodWhere ? { createdAt: periodWhere } : {}),
      },
      select: {
        id: true,
        status: true,
        rejectionReasonCode: true,
        order: { select: { orderingBranchId: true } },
      },
      take: 30000,
    }),
    prisma.orderItem.findMany({
      where: {
        order: {
          organizationId: session.user.organizationId,
          orderingBranchId: { in: branchIds },
          ...(periodWhere ? { orderedAt: periodWhere } : {}),
        },
      },
      select: {
        id: true,
        testId: true,
        testCodeSnapshot: true,
        testNameEnSnapshot: true,
        testNameArSnapshot: true,
        tatDueAt: true,
        order: { select: { orderedAt: true, orderingBranchId: true } },
        results: {
          where: { releasedAt: { not: null }, status: { in: ["RELEASED", "AMENDED"] } },
          select: { version: true, releasedAt: true, performingBranchId: true },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
      take: 30000,
    }),
    prisma.criticalResultEvent.findMany({
      where: {
        result: {
          organizationId: session.user.organizationId,
          performingBranchId: { in: branchIds },
        },
        ...(periodWhere ? { detectedAt: periodWhere } : {}),
      },
      select: { status: true, detectedAt: true, acknowledgedAt: true },
      take: 10000,
    }),
    prisma.qcRuleViolation.findMany({
      where: {
        run: {
          organizationId: session.user.organizationId,
          branchId: { in: branchIds },
        },
        ...(periodWhere ? { detectedAt: periodWhere } : {}),
      },
      select: { severity: true, status: true, detectedAt: true, resolvedAt: true },
      take: 10000,
    }),
    prisma.qualityIndicator.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
        status: "ACTIVE",
      },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        measurements: {
          where: {
            ...(start ? { periodEnd: { gte: start } } : {}),
            ...(end ? { periodStart: { lte: end } } : {}),
          },
          orderBy: { periodEnd: "desc" },
          take: 1,
        },
      },
      orderBy: { nameEn: "asc" },
      take: 500,
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const orderItemIds = orders.flatMap(order => order.items.map(item => item.id));
  const [consumptionMovements, sendOutCosts] = orderItemIds.length === 0 ? [[], []] : await Promise.all([
    prisma.stockMovement.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        movementType: "CONSUMPTION",
        referenceType: "ORDER_ITEM",
        referenceId: { in: orderItemIds },
      },
      include: { lot: { select: { unitCost: true, currency: true } } },
      take: 50000,
    }),
    prisma.sendOutReferral.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        orderItemId: { in: orderItemIds },
        status: { not: "CANCELLED" },
        costAmount: { not: null },
        costCurrency: { not: null },
      },
      select: { orderItemId: true, costAmount: true, costCurrency: true },
      take: 20000,
    }),
  ]);

  // Use the existing DECIMAL(18,4)-safe bigint accounting aggregator.
  // Revenue/discounts are selected by invoice issue date, collections by payment date,
  // and refunds/credits by their own posting dates. Outstanding is CURRENT for
  // invoices issued within the selected period, never a historical as-of balance.
  const financeByCurrency = aggregateFinancialReport({
    invoices: invoices.map(item => ({
      currency: item.currency,
      subtotal: item.subtotal.toString(),
      discountTotal: item.discountTotal.toString(),
      taxTotal: item.taxTotal.toString(),
      total: item.total.toString(),
      balanceAmount: item.balanceAmount.toString(),
    })),
    paymentAllocations: payments.map(item => ({ currency: item.currency, amount: item.amount.toString() })),
    refunds: refunds.map(item => ({ currency: item.currency, amount: item.amount.toString() })),
    creditNotes: creditNotes.map(item => ({ currency: item.currency, amount: item.amount.toString() })),
  });

  const testMap = new Map<string, {
    code: string;
    name: string;
    volume: number;
    revenue: Map<string, bigint>;
    cost: Map<string, bigint>;
    indicativeCostItems: Set<string>;
    costLinkedItems: Set<string>;
    orderItemIds: Set<string>;
  }>();
  const orderItemToTest = new Map<string, string>();
  for (const order of orders) {
    for (const item of order.items) {
      orderItemToTest.set(item.id, item.testId);
      const row = testMap.get(item.testId) || {
        code: item.testCodeSnapshot,
        name: locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot,
        volume: 0,
        revenue: new Map<string, bigint>(),
        cost: new Map<string, bigint>(),
        indicativeCostItems: new Set<string>(),
        costLinkedItems: new Set<string>(),
        orderItemIds: new Set<string>(),
      };
      row.volume += 1;
      row.orderItemIds.add(item.id);
      addCurrencyAmount(row.revenue, item.currency, item.finalPriceSnapshot.toString());
      testMap.set(item.testId, row);
    }
  }
  for (const movement of consumptionMovements) {
    if (!movement.referenceId || !movement.lot?.unitCost || !movement.lot.currency) continue;
    const testId = orderItemToTest.get(movement.referenceId);
    if (!testId) continue;
    const row = testMap.get(testId);
    if (!row) continue;
    const cost = movement.quantity.abs().mul(movement.lot.unitCost).toString();
    addCurrencyAmount(row.cost, movement.lot.currency, cost);
    // Lot prices are mutable master data, not immutable movement valuation snapshots.
    row.indicativeCostItems.add(movement.referenceId);
    row.costLinkedItems.add(movement.referenceId);
  }

  for (const sendOut of sendOutCosts) {
    if (!sendOut.costAmount || !sendOut.costCurrency) continue;
    const testId = orderItemToTest.get(sendOut.orderItemId);
    if (!testId) continue;
    const row = testMap.get(testId);
    if (!row) continue;
    addCurrencyAmount(row.cost, sendOut.costCurrency, sendOut.costAmount.toString());
    row.costLinkedItems.add(sendOut.orderItemId);
  }

  const sourceMap = new Map<string, { name: string; orders: number; revenue: Map<string, bigint> }>();
  const referrerMap = new Map<string, { name: string; orders: number; revenue: Map<string, bigint> }>();
  for (const order of orders) {
    const orderRevenue = new Map<string, bigint>();
    for (const item of order.items) {
      addCurrencyAmount(orderRevenue, item.currency, item.finalPriceSnapshot.toString());
    }

    const sourceKey = order.source?.id || "UNSPECIFIED";
    const sourceRow = sourceMap.get(sourceKey) || { name: order.source ? localizedName(order.source) : tr(locale, "Unspecified", "غير محدد"), orders: 0, revenue: new Map<string, bigint>() };
    sourceRow.orders++;
    for (const [currency, amount] of orderRevenue) sourceRow.revenue.set(currency, (sourceRow.revenue.get(currency) || BigInt(0)) + amount);
    sourceMap.set(sourceKey, sourceRow);

    if (order.referrer) {
      const refRow = referrerMap.get(order.referrer.id) || { name: localizedName(order.referrer), orders: 0, revenue: new Map<string, bigint>() };
      refRow.orders++;
      for (const [currency, amount] of orderRevenue) refRow.revenue.set(currency, (refRow.revenue.get(currency) || BigInt(0)) + amount);
      referrerMap.set(order.referrer.id, refRow);
    }
  }

  const branchMap = new Map(branches.map(branch => [branch.id, {
    id: branch.id,
    code: branch.code,
    name: localizedName(branch),
    orders: 0,
    completed: 0,
    patients: new Set<string>(),
    testVolume: 0,
    invoiceCountByCurrency: new Map<string, number>(),
    revenue: new Map<string, bigint>(),
    discounts: new Map<string, bigint>(),
    outstanding: new Map<string, bigint>(),
    collected: new Map<string, bigint>(),
    slaCount: 0,
    slaWithin: 0,
    tatMinutes: [] as number[],
    specimens: 0,
    rejectedSpecimens: 0,
  }]));
  for (const order of orders) {
    const row = branchMap.get(order.orderingBranchId);
    if (!row) continue;
    row.orders++;
    row.patients.add(order.patientId);
    row.testVolume += order.items.length;
    if (order.status === "COMPLETED") row.completed++;
  }
  for (const invoice of invoices) {
    const row = branchMap.get(invoice.branchId);
    if (!row) continue;
    addCurrencyAmount(row.revenue, invoice.currency, invoice.total.toString());
    addCurrencyAmount(row.discounts, invoice.currency, invoice.discountTotal.toString());
    addCurrencyAmount(row.outstanding, invoice.currency, invoice.balanceAmount.toString());
    row.invoiceCountByCurrency.set(invoice.currency, (row.invoiceCountByCurrency.get(invoice.currency) || 0) + 1);
  }
  for (const payment of payments) {
    const row = branchMap.get(payment.branchId);
    if (!row) continue;
    addCurrencyAmount(row.collected, payment.currency, payment.amount.toString());
  }

  const tatMinutes: number[] = [];
  const tatByTest = new Map<string, { label: string; values: number[] }>();
  for (const item of tatItems) {
    const latest = item.results[0];
    if (!latest?.releasedAt) continue;
    const minutes = (latest.releasedAt.getTime() - item.order.orderedAt.getTime()) / 60000;
    if (minutes < 0 || !Number.isFinite(minutes)) continue;
    tatMinutes.push(minutes);
    const branchRow = branchMap.get(item.order.orderingBranchId);
    if (branchRow) {
      branchRow.tatMinutes.push(minutes);
      if (item.tatDueAt) {
        branchRow.slaCount++;
        if (latest.releasedAt <= item.tatDueAt) branchRow.slaWithin++;
      }
    }
    const row = tatByTest.get(item.testId) || { label: item.testCodeSnapshot + " — " + (locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot), values: [] };
    row.values.push(minutes);
    tatByTest.set(item.testId, row);
  }

  for (const specimen of specimens) {
    const row = branchMap.get(specimen.order.orderingBranchId);
    if (!row) continue;
    row.specimens++;
    if (specimen.status === "REJECTED") row.rejectedSpecimens++;
  }

  // Specimen query intentionally omits patient/order details; derive branch counts with a separate compact query.
  const specimenBranchCounts = await prisma.specimen.groupBy({
    by: ["status"],
    where: {
      organizationId: session.user.organizationId,
      order: { orderingBranchId: { in: branchIds } },
      ...(periodWhere ? { createdAt: periodWhere } : {}),
    },
    _count: { _all: true },
  });
  const totalSpecimens = specimenBranchCounts.reduce((sum, item) => sum + item._count._all, 0);
  const rejectedSpecimens = specimenBranchCounts.find(item => item.status === "REJECTED")?._count._all || 0;

  const avgTat = tatMinutes.length ? tatMinutes.reduce((a, b) => a + b, 0) / tatMinutes.length : null;
  const sortedTat = [...tatMinutes].sort((a, b) => a - b);
  const p90Tat = sortedTat.length ? sortedTat[Math.min(sortedTat.length - 1, Math.floor(sortedTat.length * 0.9))] : null;
  const criticalAckMinutes = criticalEvents
    .filter(item => item.acknowledgedAt)
    .map(item => (item.acknowledgedAt!.getTime() - item.detectedAt.getTime()) / 60000)
    .filter(value => value >= 0);
  const avgCriticalAck = criticalAckMinutes.length
    ? criticalAckMinutes.reduce((a, b) => a + b, 0) / criticalAckMinutes.length
    : null;

  const uniquePatients = new Set(orders.map(order => order.patientId)).size;
  const completedOrders = orders.filter(order => order.status === "COMPLETED").length;
  const completionRate = orders.length ? completedOrders / orders.length * 100 : 0;
  const rejectionRate = totalSpecimens ? rejectedSpecimens / totalSpecimens * 100 : 0;
  const openCritical = criticalEvents.filter(item => item.status === "OPEN").length;
  const openQcBlocks = qcViolations.filter(item => item.status === "OPEN" && item.severity === "BLOCK").length;

  const topTests = [...testMap.values()].sort((a, b) => b.volume - a.volume).slice(0, 12);
  const topSources = [...sourceMap.values()].sort((a, b) => b.orders - a.orders).slice(0, 10);
  const topReferrers = [...referrerMap.values()].sort((a, b) => b.orders - a.orders).slice(0, 10);
  const slowestTests = [...tatByTest.values()]
    .map(row => ({ label: row.label, average: row.values.reduce((a, b) => a + b, 0) / row.values.length, count: row.values.length }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 10);

  const periodLabel = start || end
    ? (start ? start.toISOString().slice(0, 10) : tr(locale, "Beginning", "البداية")) + " → " + (end ? end.toISOString().slice(0, 10) : tr(locale, "Now", "الآن"))
    : tr(locale, "All time", "كل الوقت");

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Analytics & Management", "التحليلات والإدارة")}</p>
        <h1>{tr(locale, "Management Analytics", "التحليلات الإدارية")}</h1>
        <p className="muted">{tr(locale, "Branch-scoped operational, financial, TAT, source/referrer, test profitability and quality KPIs. Money is never combined across currencies.", "مؤشرات تشغيلية ومالية وزمن الإنجاز والمصادر والمحيلين وربحية الفحوصات والجودة ضمن نطاق الفروع المصرح بها. لا يتم جمع الأموال بين عملات مختلفة.")}</p>
      </div>
      <div className="result-actions"><Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}</Link></div>
    </header>

    <form className="filter-bar" method="get">
      <label>{tr(locale, "Period", "الفترة")}<select name="period" defaultValue={period}>
        <option value="7d">{tr(locale, "Last 7 days", "آخر 7 أيام")}</option>
        <option value="30d">{tr(locale, "Last 30 days", "آخر 30 يوماً")}</option>
        <option value="90d">{tr(locale, "Last 90 days", "آخر 90 يوماً")}</option>
        <option value="365d">{tr(locale, "Last 12 months", "آخر 12 شهراً")}</option>
        <option value="all">{tr(locale, "All time", "كل الوقت")}</option>
        <option value="custom">{tr(locale, "Custom", "مخصص")}</option>
      </select></label>
      <label>{tr(locale, "Branch", "الفرع")}<select name="branchId" defaultValue={selectedBranchId || ""}>
        <option value="">{tr(locale, "All authorized branches", "كل الفروع المصرح بها")}</option>
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
      </select></label>
      <label>{tr(locale, "From", "من")}<input type="date" name="from" defaultValue={first(params.from) || ""} /></label>
      <label>{tr(locale, "To", "إلى")}<input type="date" name="to" defaultValue={first(params.to) || ""} /></label>
      <button className="secondary-button" type="submit">{tr(locale, "Apply", "تطبيق")}</button>
      <span className="muted">{periodLabel}</span>
    </form>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Orders", "الطلبات")}</h2><strong>{orders.length.toLocaleString()}</strong><p className="muted">{completionRate.toFixed(1)}% {tr(locale, "completed", "مكتملة")} · {uniquePatients.toLocaleString()} {tr(locale, "unique patients", "مريض مختلف")}.</p></article>
      <article className="detail-card"><h2>{tr(locale, "Average TAT", "متوسط زمن الإنجاز TAT")}</h2><strong>{minuteLabel(avgTat, locale)}</strong><p className="muted">{tr(locale, "Order registration to latest released result.", "من تسجيل الطلب حتى أحدث نتيجة صادرة.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "P90 TAT", "زمن الإنجاز P90")}</h2><strong>{minuteLabel(p90Tat, locale)}</strong><p className="muted">{tr(locale, "90% of released test items completed within this time.", "اكتمل 90% من عناصر الفحوصات الصادرة ضمن هذا الزمن.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Specimen Rejection", "رفض العينات")}</h2><strong>{rejectionRate.toFixed(2)}%</strong><p className="muted">{rejectedSpecimens} {tr(locale, "rejected of", "مرفوضة من أصل")} {totalSpecimens} {tr(locale, "specimens", "عينة")}.</p></article>
      <article className="detail-card"><h2>{tr(locale, "Open Critical", "نتائج حرجة مفتوحة")}</h2><strong>{openCritical}</strong><p className="muted">{tr(locale, "Average acknowledgement:", "متوسط زمن الإقرار:")} {minuteLabel(avgCriticalAck, locale)}.</p></article>
      <article className="detail-card"><h2>{tr(locale, "Open QC Blocks", "حالات حظر QC المفتوحة")}</h2><strong>{openQcBlocks}</strong><p className="muted">{tr(locale, "Unresolved blocking Westgard/QC violations.", "مخالفات Westgard/QC الحاجبة التي لم تُحل بعد.")}</p></article>
    </section>

    <section className="detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Financial Summary", "الملخص المالي")}</h2><span>{tr(locale, "Per currency", "حسب كل عملة")}</span></div>
      <p className="muted">{tr(locale,
        "Issue-date invoice totals and current outstanding are not a historical balance at the period end. Collections, refunds and credits follow their own transaction dates; currencies are never combined.",
        "قيم الفواتير حسب تاريخ إصدارها، والمستحق هو الرصيد الحالي وليس رصيد نهاية الفترة التاريخي. التحصيل والاسترداد والإشعارات الدائنة حسب تاريخ كل عملية، ولا يتم دمج العملات.")}</p>
      <div className="detail-grid">
        {financeByCurrency.map(row => <article className="detail-card" key={row.currency}>
          <h2>{row.currency}</h2>
          <dl className="compact-kpis">
            <div><dt>{tr(locale, "Gross invoiced before discount", "قيمة الفواتير قبل الخصم")}</dt><dd>{financialText(row.gross, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Discounts", "الخصومات")}</dt><dd>{financialText(row.discounts, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Tax", "الضريبة")}</dt><dd>{financialText(row.tax, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Invoiced", "المفوتر")}</dt><dd>{financialText(row.invoiced, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Credit notes issued in period", "الإشعارات الدائنة الصادرة خلال الفترة")}</dt><dd>{financialText(row.creditNotes, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Gross collected in period", "إجمالي المحصّل خلال الفترة")}</dt><dd>{financialText(row.collected, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Refunds posted in period", "المسترد خلال الفترة")}</dt><dd>{financialText(row.refunds, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Net collected in period", "صافي المحصّل خلال الفترة")}</dt><dd>{financialText(row.netCollected, row.currency)}</dd></div>
            <div><dt>{tr(locale, "Current outstanding on period invoices", "المستحق الحالي لفواتير الفترة")}</dt><dd>{financialText(row.outstandingCurrent, row.currency)}</dd></div>
          </dl>
        </article>)}
        {financeByCurrency.length === 0 && <article className="detail-card"><p className="muted">{tr(locale, "No financial activity in the selected period.", "لا توجد حركة مالية ضمن الفترة المحددة.")}</p></article>}
      </div>
    </section>

    <section className="detail-grid detail-section">
      <AnalyticsBars title={tr(locale, "Top Tests by Volume", "أكثر الفحوصات حسب العدد")} emptyText={tr(locale, "No data for the selected period.", "لا توجد بيانات ضمن الفترة المحددة.")} items={topTests.map(test => ({ label: test.code + " — " + test.name, value: test.volume }))} />
      <AnalyticsBars title={tr(locale, "Top Sources", "أعلى المصادر")} emptyText={tr(locale, "No data for the selected period.", "لا توجد بيانات ضمن الفترة المحددة.")} items={topSources.map(source => ({ label: source.name, value: source.orders }))} />
      <AnalyticsBars title={tr(locale, "Top Referrers", "أعلى المحيلين")} emptyText={tr(locale, "No data for the selected period.", "لا توجد بيانات ضمن الفترة المحددة.")} items={topReferrers.map(referrer => ({ label: referrer.name, value: referrer.orders }))} />
      <AnalyticsBars title={tr(locale, "Slowest Tests by Average TAT", "أبطأ الفحوصات حسب متوسط TAT")} emptyText={tr(locale, "No data for the selected period.", "لا توجد بيانات ضمن الفترة المحددة.")} items={slowestTests.map(test => ({ label: test.label, value: test.average, displayValue: minuteLabel(test.average, locale) + " · " + tr(locale, "n=", "عدد=") + test.count }))} />
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Branch Comparison", "مقارنة الفروع")}</h2><span>{branchMap.size} {tr(locale, "branches", "فروع")}</span></div>
      <p className="muted">{tr(locale, "Average invoice and revenue are shown by original currency; current outstanding is not a historical period-end balance. TAT SLA covers only released tests with stored due-time snapshots.", "متوسط الفاتورة والإيرادات حسب العملة الأصلية؛ المستحق الحالي ليس رصيد نهاية الفترة التاريخي. الالتزام بزمن الإنجاز يشمل النتائج الصادرة ذات موعد الاستحقاق المحفوظ.")}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Orders", "الطلبات")}</th><th>{tr(locale, "Patients", "المرضى")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th><th>{tr(locale, "Completed", "المكتملة")}</th><th>{tr(locale, "Completion", "نسبة الإكمال")}</th><th>{tr(locale, "Avg TAT", "متوسط TAT")}</th><th>{tr(locale, "TAT SLA", "التزام وقت الفحوصات")}</th><th>{tr(locale, "Specimen rejection", "رفض العينات")}</th><th>{tr(locale, "Invoiced", "المفوتر")}</th><th>{tr(locale, "Average invoice", "متوسط الفاتورة")}</th><th>{tr(locale, "Discounts", "الخصومات")}</th><th>{tr(locale, "Current outstanding", "المستحق الحالي")}</th><th>{tr(locale, "Collected", "المحصّل")}</th></tr></thead>
        <tbody>{[...branchMap.values()].map(branch => {
          const avg = branch.tatMinutes.length ? branch.tatMinutes.reduce((a,b) => a+b,0) / branch.tatMinutes.length : null;
          return <tr key={branch.id}>
            <td><strong>{branch.code}</strong><br/><small>{branch.name}</small></td>
            <td>{branch.orders}</td>
            <td>{branch.patients.size}</td>
            <td>{branch.testVolume}</td>
            <td>{branch.completed}</td>
            <td>{branch.orders ? (branch.completed / branch.orders * 100).toFixed(1) + "%" : "—"}</td>
            <td>{minuteLabel(avg, locale)}</td>
            <td>{branch.slaCount ? (branch.slaWithin / branch.slaCount * 100).toFixed(1) + "% (n=" + branch.slaCount + ")" : "—"}</td>
            <td>{branch.specimens ? (branch.rejectedSpecimens / branch.specimens * 100).toFixed(2) + "%" : "—"}</td>
            <td>{[...branch.revenue.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td>
            <td>{[...branch.revenue.entries()].map(([currency, amount]) => moneyText(amount / BigInt(branch.invoiceCountByCurrency.get(currency) || 1), currency)).join(" · ") || "—"}</td>
            <td>{[...branch.discounts.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td>
            <td>{[...branch.outstanding.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td>
            <td>{[...branch.collected.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Ordered Test Value & Indicative Cost Coverage", "قيمة الفحوصات المطلوبة والتكاليف التقديرية المرتبطة")}</h2><span>{tr(locale, "Inventory cost is estimated from CURRENT lot prices, not preserved historical valuation.", "تكلفة المخزون مقدّرة بسعر الدفعة الحالي وليست لقطة تكلفة تاريخية محفوظة.")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Volume", "العدد")}</th><th>{tr(locale, "Revenue", "الإيراد")}</th><th>{tr(locale, "Attributed laboratory cost", "تكلفة المختبر المنسوبة")}</th><th>{tr(locale, "Margin only with full, historically comparable cost", "الهامش فقط مع تكلفة تاريخية مكتملة وقابلة للمقارنة")}</th><th>{tr(locale, "Linked-cost coverage (not completeness guarantee)", "نسبة البنود المرتبطة بتكلفة (ليست ضمان اكتمال)")}</th></tr></thead>
        <tbody>{topTests.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No test activity in the selected period.", "لا توجد حركة فحوصات ضمن الفترة المحددة.")}</td></tr> : topTests.map(test => {
          const revenueText = [...test.revenue.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ");
          const costText = [...test.cost.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || tr(locale, "No linked cost", "لا توجد تكلفة مرتبطة");
          const margins = [...comparableMargin({
            revenue: test.revenue,
            cost: test.cost,
            totalItems: test.orderItemIds.size,
            coveredItems: test.costLinkedItems.size,
            indicativeCostItems: test.indicativeCostItems.size,
          }).entries()].map(([currency, amount]) => moneyText(amount, currency));
          const coverage = test.orderItemIds.size ? test.costLinkedItems.size / test.orderItemIds.size * 100 : 0;
          return <tr key={test.code}>
            <td><strong>{test.code}</strong><br/><small>{test.name}</small></td>
            <td>{test.volume}</td>
            <td>{revenueText || "—"}</td>
            <td>{costText}</td>
            <td>{margins.join(" · ") || tr(locale, "Unverified: missing/indicative/mixed-currency cost", "غير موثوق: تكلفة ناقصة أو تقديرية أو بعملات مختلفة")}</td>
            <td>{coverage.toFixed(1)}%</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Source Analytics", "تحليلات المصادر")}</h2><span>{sourceMap.size}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Source", "المصدر")}</th><th>{tr(locale, "Orders", "الطلبات")}</th><th>{tr(locale, "Revenue", "الإيراد")}</th></tr></thead>
          <tbody>{topSources.length === 0 ? <tr><td colSpan={3} className="empty-state">{tr(locale, "No source-linked orders.", "لا توجد طلبات مرتبطة بمصدر.")}</td></tr> : topSources.map(source => <tr key={source.name}><td>{source.name}</td><td>{source.orders}</td><td>{[...source.revenue.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td></tr>)}</tbody>
        </table></div>
      </article>
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Referrer Analytics", "تحليلات المحيلين")}</h2><span>{referrerMap.size}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Referrer", "المحيل")}</th><th>{tr(locale, "Orders", "الطلبات")}</th><th>{tr(locale, "Revenue", "الإيراد")}</th></tr></thead>
          <tbody>{topReferrers.length === 0 ? <tr><td colSpan={3} className="empty-state">{tr(locale, "No referrer-linked orders.", "لا توجد طلبات مرتبطة بمحيل.")}</td></tr> : topReferrers.map(referrer => <tr key={referrer.name}><td>{referrer.name}</td><td>{referrer.orders}</td><td>{[...referrer.revenue.entries()].map(([currency, amount]) => moneyText(amount, currency)).join(" · ") || "—"}</td></tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Quality KPIs", "مؤشرات الجودة الرئيسية")}</h2><span>{tr(locale, "Latest measurement in selected period", "أحدث قياس ضمن الفترة المحددة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Indicator", "المؤشر")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Value", "القيمة")}</th><th>{tr(locale, "Target", "الهدف")}</th><th>{tr(locale, "Period", "الفترة")}</th></tr></thead>
        <tbody>{qualityIndicators.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No quality indicators configured.", "لا توجد مؤشرات جودة مهيأة.")}</td></tr> : qualityIndicators.map(indicator => {
          const measurement = indicator.measurements[0];
          const target = indicator.direction === "TARGET_RANGE"
            ? (indicator.targetMin?.toString() || "—") + " – " + (indicator.targetMax?.toString() || "—")
            : indicator.direction === "LOWER_IS_BETTER"
              ? "≤ " + (indicator.targetMax?.toString() || "—")
              : "≥ " + (indicator.targetMin?.toString() || "—");
          return <tr key={indicator.id}>
            <td><strong>{indicator.code}</strong><br/><small>{localizedName(indicator)}</small></td>
            <td>{indicator.branch ? indicator.branch.code + " — " + localizedName(indicator.branch) : tr(locale, "Organization", "المؤسسة")}</td>
            <td>{measurement ? measurement.value.toString() + (indicator.unit ? " " + indicator.unit : "") : "—"}</td>
            <td>{target}</td>
            <td>{measurement ? measurement.periodStart.toISOString().slice(0,10) + " → " + measurement.periodEnd.toISOString().slice(0,10) : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </main>;
}
