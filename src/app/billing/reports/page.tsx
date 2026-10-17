import { TableEmptyState } from "@/components/table-empty-state";
import { SystemDateField } from "@/components/system-date-field";
import Link from "next/link";
import type { Prisma } from "../../../../generated/prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aggregateFinancialReport } from "@/lib/financial-reporting";
import { localCalendarDate } from "@/lib/accounts-receivable-aging";
import { localDateTimeToUtc } from "@/lib/order-questions";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveReportPeriod(
  params: Record<string, string | string[] | undefined>,
  timeZone: string,
) {
  const period = first(params.period) || "30d";
  const today = localCalendarDate(new Date(), timeZone) || new Date().toISOString().slice(0, 10);
  let from: string | null;
  let to: string | null;

  if (period === "7d") {
    from = addCalendarDays(today, -6);
    to = today;
  } else if (period === "30d") {
    from = addCalendarDays(today, -29);
    to = today;
  } else if (period === "90d") {
    from = addCalendarDays(today, -89);
    to = today;
  } else if (period === "365d") {
    from = addCalendarDays(today, -364);
    to = today;
  } else if (period === "all") {
    from = null;
    to = null;
  } else if (period === "custom") {
    const requestedFrom = first(params.from) || "";
    const requestedTo = first(params.to) || "";
    from = validCalendarDate(requestedFrom) ? requestedFrom : null;
    to = validCalendarDate(requestedTo) ? requestedTo : today;
  } else {
    from = addCalendarDays(today, -29);
    to = today;
  }

  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  const start = from ? localDateTimeToUtc(from + "T00:00:00", timeZone) : null;
  const endExclusive = to
    ? localDateTimeToUtc(addCalendarDays(to, 1) + "T00:00:00", timeZone)
    : null;

  return {
    period: ["7d", "30d", "90d", "365d", "all", "custom"].includes(period) ? period : "30d",
    from,
    to,
    start,
    endExclusive,
  };
}

function dateWhere(start: Date | null, endExclusive: Date | null) {
  if (!start && !endExclusive) return undefined;
  return {
    ...(start ? { gte: start } : {}),
    ...(endExclusive ? { lt: endExclusive } : {}),
  };
}

export default async function FinancialReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const params = await searchParams;
  const organizationId = session.user.organizationId;
  const authorizedBranchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, sources, referrers, clients, tests, cashiers, paymentMethods] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId, id: { in: authorizedBranchIds } },
      select: { id: true, code: true, nameEn: true, nameAr: true, timezone: true },
      orderBy: { code: "asc" },
    }),
    prisma.orderSource.findMany({
      where: { organizationId },
      select: { id: true, code: true, nameEn: true, nameAr: true, category: true },
      orderBy: [{ category: "asc" }, { code: "asc" }],
    }),
    prisma.referrer.findMany({
      where: { organizationId },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      where: {
        organizationId,
        cashierPayments: { some: { branchId: { in: authorizedBranchIds } } },
      },
      select: { id: true, username: true, displayNameEn: true, displayNameAr: true },
      orderBy: { displayNameEn: "asc" },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isSettlement: true },
      select: { id: true, code: true, nameEn: true, nameAr: true, status: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
  ]);

  const requestedBranchId = first(params.branchId) || "";
  const branchId = branches.some(item => item.id === requestedBranchId) ? requestedBranchId : "";
  const branchIds = branchId ? [branchId] : authorizedBranchIds;
  const reportTimeZone = branchId
    ? branches.find(item => item.id === branchId)?.timezone || session.user.organization.defaultTimezone
    : session.user.organization.defaultTimezone;
  const period = resolveReportPeriod(params, reportTimeZone);
  const periodWhere = dateWhere(period.start, period.endExclusive);

  const selectedFrom = <T extends { id: string }>(rows: T[], value: string | undefined) => {
    const id = value || "";
    return rows.some(item => item.id === id) ? id : "";
  };
  const sourceId = selectedFrom(sources, first(params.sourceId));
  const referrerId = selectedFrom(referrers, first(params.referrerId));
  const clientId = selectedFrom(clients, first(params.clientId));
  const testId = selectedFrom(tests, first(params.testId));
  const cashierUserId = selectedFrom(cashiers, first(params.cashierUserId));
  const paymentMethodId = selectedFrom(paymentMethods, first(params.paymentMethodId));
  const requestedCurrency = (first(params.currency) || "").trim().toUpperCase();
  const currency = /^[A-Z]{3}$/.test(requestedCurrency) ? requestedCurrency : "";

  const orderContext: Prisma.LabOrderWhereInput = {};
  if (sourceId) orderContext.sourceId = sourceId;
  if (referrerId) orderContext.referrerId = referrerId;
  if (testId) orderContext.items = { some: { testId } };

  const invoiceContext: Prisma.InvoiceWhereInput = {
    organizationId,
    branchId: { in: branchIds },
    status: { not: "VOID" },
    ...(clientId ? { clientId } : {}),
    ...(currency ? { currency } : {}),
    ...(Object.keys(orderContext).length ? { order: orderContext } : {}),
  };

  const paymentContext: Prisma.PaymentWhereInput = {
    organizationId,
    branchId: { in: branchIds },
    status: { not: "VOIDED" },
    ...(paymentMethodId ? { paymentMethodConfigId: paymentMethodId } : {}),
    ...(cashierUserId ? { cashierUserId } : {}),
    ...(currency ? { currency } : {}),
  };

  const [invoices, paymentAllocations, creditNotes, refunds] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        ...invoiceContext,
        ...(periodWhere ? { issuedAt: periodWhere } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        total: true,
        balanceAmount: true,
        issuedAt: true,
        branch: { select: { code: true } },
        client: { select: { code: true, nameEn: true, nameAr: true } },
        order: {
          select: {
            accessionNumber: true,
            source: { select: { code: true, nameEn: true, nameAr: true } },
            referrer: { select: { code: true, nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.paymentAllocation.findMany({
      where: {
        invoice: invoiceContext,
        payment: {
          ...paymentContext,
          ...(periodWhere ? { receivedAt: periodWhere } : {}),
        },
      },
      select: {
        amount: true,
        invoice: { select: { invoiceNumber: true } },
        payment: {
          select: {
            id: true,
            currency: true,
            method: true,
            paymentMethodCodeSnapshot: true,
            paymentMethodNameEnSnapshot: true,
            paymentMethodNameArSnapshot: true,
            receivedAt: true,
            cashier: { select: { displayNameEn: true, displayNameAr: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.creditNote.findMany({
      where: {
        organizationId,
        branchId: { in: branchIds },
        status: "ISSUED",
        ...(currency ? { currency } : {}),
        ...(periodWhere ? { issuedAt: periodWhere } : {}),
        invoice: invoiceContext,
      },
      select: {
        id: true,
        creditNoteNumber: true,
        currency: true,
        amount: true,
        issuedAt: true,
        reason: true,
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.refund.findMany({
      where: {
        organizationId,
        branchId: { in: branchIds },
        status: "POSTED",
        ...(currency ? { currency } : {}),
        ...(periodWhere ? { processedAt: periodWhere } : {}),
        invoice: invoiceContext,
        ...(paymentMethodId ? { paymentMethodConfigId: paymentMethodId } : {}),
        payment: {
          ...(cashierUserId ? { cashierUserId } : {}),
        },
      },
      select: {
        id: true,
        refundNumber: true,
        currency: true,
        amount: true,
        processedAt: true,
        method: true,
        paymentMethodCodeSnapshot: true,
        paymentMethodNameEnSnapshot: true,
        paymentMethodNameArSnapshot: true,
        reason: true,
        invoice: { select: { invoiceNumber: true } },
        payment: {
          select: {
            cashier: { select: { displayNameEn: true, displayNameAr: true } },
          },
        },
      },
      orderBy: { processedAt: "desc" },
    }),
  ]);

  const summaries = aggregateFinancialReport({
    invoices: invoices.map(item => ({
      currency: item.currency,
      subtotal: item.subtotal.toFixed(4),
      discountTotal: item.discountTotal.toFixed(4),
      taxTotal: item.taxTotal.toFixed(4),
      total: item.total.toFixed(4),
      balanceAmount: item.balanceAmount.toFixed(4),
    })),
    paymentAllocations: paymentAllocations.map(item => ({
      currency: item.payment.currency,
      amount: item.amount.toFixed(4),
    })),
    creditNotes: creditNotes.map(item => ({
      currency: item.currency,
      amount: item.amount.toFixed(4),
    })),
    refunds: refunds.map(item => ({
      currency: item.currency,
      amount: item.amount.toFixed(4),
    })),
  });

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const periodLabel = period.from || period.to
    ? (period.from || tr(locale, "Beginning", "البداية")) + " → " + (period.to || tr(locale, "Today", "اليوم"))
    : tr(locale, "All time", "كل الوقت");

  return <main className="catalog-shell filter-workspace">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Financial Reports", "التقارير المالية")}</h1>
        <p className="muted">{tr(
          locale,
          "Operational financial reporting from immutable invoice and transaction records. Amounts are never combined across currencies.",
          "تقارير مالية تشغيلية من سجلات الفواتير والحركات غير القابلة للتغيير. لا يتم جمع المبالغ بين العملات المختلفة.",
        )}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/billing/accounts/aging">{tr(locale, "Receivables Aging", "أعمار الذمم")}</Link>
        <Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link>
      </div>
    </header>

    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr(locale, "Report Filters", "مرشحات التقرير")}</h2>
          <span>{tr(locale, "Reporting timezone", "المنطقة الزمنية للتقرير")}: {reportTimeZone} · {periodLabel}</span>
        </div>
      </div>
      <form className="catalog-form filter-grid" action="/billing/reports" method="get">
        <label>{tr(locale, "Period", "الفترة")}<select name="period" defaultValue={period.period}>
          <option value="7d">{tr(locale, "Last 7 days", "آخر 7 أيام")}</option>
          <option value="30d">{tr(locale, "Last 30 days", "آخر 30 يوماً")}</option>
          <option value="90d">{tr(locale, "Last 90 days", "آخر 90 يوماً")}</option>
          <option value="365d">{tr(locale, "Last 12 months", "آخر 12 شهراً")}</option>
          <option value="all">{tr(locale, "All time", "كل الوقت")}</option>
          <option value="custom">{tr(locale, "Custom", "مخصص")}</option>
        </select></label>
        <label>{tr(locale, "Branch", "الفرع")}<select name="branchId" defaultValue={branchId}>
          <option value="">{tr(locale, "All authorized branches", "كل الفروع المصرح بها")}</option>
          {branches.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
        </select></label>
        <label>{tr(locale, "Source / Campaign", "المصدر / الحملة")}<select name="sourceId" defaultValue={sourceId}>
          <option value="">{tr(locale, "All sources", "كل المصادر")}</option>
          {sources.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
        </select></label>
        <label>{tr(locale, "Referrer", "المحيل")}<select name="referrerId" defaultValue={referrerId}>
          <option value="">{tr(locale, "All referrers", "كل المحيلين")}</option>
          {referrers.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
        </select></label>
        <label>{tr(locale, "Client", "العميل")}<select name="clientId" defaultValue={clientId}>
          <option value="">{tr(locale, "All clients", "كل العملاء")}</option>
          {clients.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
        </select></label>
        <label>{tr(locale, "Test", "الفحص")}<select name="testId" defaultValue={testId}>
          <option value="">{tr(locale, "All tests", "كل الفحوصات")}</option>
          {tests.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
        </select></label>
        <label>{tr(locale, "Payment method", "طريقة الدفع")}<select name="paymentMethodId" defaultValue={paymentMethodId}>
          <option value="">{tr(locale, "All methods", "كل الطرق")}</option>
          {paymentMethods.map(item => <option key={item.id} value={item.id}>{locale === "ar" ? item.nameAr || item.nameEn : item.nameEn} · {item.code}{item.status === "INACTIVE" ? " · " + tr(locale, "Inactive", "غير نشطة") : ""}</option>)}
        </select></label>
        <label>{tr(locale, "Cashier", "أمين الصندوق")}<select name="cashierUserId" defaultValue={cashierUserId}>
          <option value="">{tr(locale, "All cashiers", "كل أمناء الصندوق")}</option>
          {cashiers.map(item => <option key={item.id} value={item.id}>{locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn} · {item.username}</option>)}
        </select></label>
        <label>{tr(locale, "Currency", "العملة")}<input name="currency" maxLength={3} defaultValue={currency} placeholder={tr(locale, "All", "الكل")} /></label>
        <label>{tr(locale, "From", "من")}<SystemDateField name="from" defaultValue={period.from || ""} /></label>
        <label>{tr(locale, "To", "إلى")}<SystemDateField name="to" defaultValue={period.to || ""} /></label>
        <button className="primary-button" type="submit">{tr(locale, "Apply Report", "تطبيق التقرير")}</button>
        <Link className="secondary-link" href="/billing/reports">{tr(locale, "Reset filters", "إعادة ضبط الفلاتر")}</Link>
      </form>
      <div className="form-warning">
        {tr(
          locale,
          "Date basis is explicit: invoice KPIs use invoice issue time; collections use payment received time; credit notes use credit-note issue time; refunds use refund processing time. Payment method and cashier filters affect collection/refund metrics only. Outstanding is the current balance of invoices issued in the selected invoice period.",
          "أساس التاريخ واضح: مؤشرات الفواتير تعتمد وقت إصدار الفاتورة، والتحصيل يعتمد وقت استلام الدفعة، والإشعارات الدائنة تعتمد وقت إصدارها، والاستردادات تعتمد وقت تنفيذها. مرشحا طريقة الدفع وأمين الصندوق يؤثران على التحصيل والاسترداد فقط. المتبقي هو الرصيد الحالي للفواتير الصادرة ضمن فترة الفواتير المحددة.",
        )}
      </div>
    </section>

    <section className="finance-kpi-grid">
      {summaries.map(summary => <article key={summary.currency}>
        <div><span>{summary.currency}</span><small>{periodLabel}</small></div>
        <dl>
          <div><dt>{tr(locale, "Gross", "الإجمالي قبل الخصم")}</dt><dd>{summary.gross}</dd></div>
          <div><dt>{tr(locale, "Discounts", "الخصومات")}</dt><dd>{summary.discounts}</dd></div>
          <div><dt>{tr(locale, "Tax", "الضريبة")}</dt><dd>{summary.tax}</dd></div>
          <div><dt>{tr(locale, "Invoiced", "المفوتر")}</dt><dd>{summary.invoiced}</dd></div>
          <div><dt>{tr(locale, "Credit notes issued", "الإشعارات الدائنة الصادرة")}</dt><dd>{summary.creditNotes}</dd></div>
          <div><dt>{tr(locale, "Collected allocations", "التحصيل المخصص")}</dt><dd>{summary.collected}</dd></div>
          <div><dt>{tr(locale, "Refunds", "الاستردادات")}</dt><dd>{summary.refunds}</dd></div>
          <div><dt>{tr(locale, "Net cash movement", "صافي الحركة النقدية")}</dt><dd>{summary.netCollected}</dd></div>
          <div><dt>{tr(locale, "Current outstanding", "المتبقي الحالي")}</dt><dd className={summary.outstandingCurrent !== "0.0000" ? "finance-due" : ""}>{summary.outstandingCurrent}</dd></div>
        </dl>
      </article>)}
      {summaries.length === 0 && <article><div><span>{tr(locale, "No financial activity", "لا توجد حركة مالية")}</span><small>{tr(locale, "for the selected filters", "ضمن المرشحات المحددة")}</small></div></article>}
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Invoice Detail", "تفاصيل الفواتير")}</h2><span>{invoices.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Issued", "الإصدار")}</th>
          <th>{tr(locale, "Invoice", "الفاتورة")}</th>
          <th>{tr(locale, "Order", "الطلب")}</th>
          <th>{tr(locale, "Source", "المصدر")}</th>
          <th>{tr(locale, "Referrer", "المحيل")}</th>
          <th>{tr(locale, "Client", "العميل")}</th>
          <th>{tr(locale, "Branch", "الفرع")}</th>
          <th>{tr(locale, "Gross", "الإجمالي")}</th>
          <th>{tr(locale, "Discount", "الخصم")}</th>
          <th>{tr(locale, "Tax", "الضريبة")}</th>
          <th>{tr(locale, "Total", "المجموع")}</th>
          <th>{tr(locale, "Current balance", "الرصيد الحالي")}</th>
        </tr></thead>
        <tbody>{invoices.length === 0 ? <tr><td colSpan={12} className="empty-state"><TableEmptyState title={tr(locale, "No invoices match the selected invoice filters.", "لا توجد فواتير تطابق مرشحات الفواتير المحددة.")} description={tr(locale, "No invoices match this report view. Review the reporting period and authorized branch before interpreting totals.", "لا توجد فواتير تطابق عرض التقرير. راجع الفترة وفرعك المصرح به قبل تفسير الإجماليات.")} action={{ href: "/billing/reports", label: tr(locale, "Clear filters", "مسح الفلاتر") }} /></td></tr> : invoices.slice(0, 1000).map(item => <tr key={item.id}>
          <td>{item.issuedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
          <td><strong>{item.invoiceNumber}</strong><br/><small>{item.currency}</small></td>
          <td>{item.order?.accessionNumber || "—"}</td>
          <td>{item.order?.source ? item.order.source.code + " — " + localizedName(item.order.source) : "—"}</td>
          <td>{item.order?.referrer ? item.order.referrer.code + " — " + localizedName(item.order.referrer) : "—"}</td>
          <td>{item.client ? item.client.code + " — " + localizedName(item.client) : "—"}</td>
          <td>{item.branch.code}</td>
          <td>{item.subtotal.toFixed(4)}</td>
          <td>{item.discountTotal.toFixed(4)}</td>
          <td>{item.taxTotal.toFixed(4)}</td>
          <td>{item.total.toFixed(4)}</td>
          <td>{item.balanceAmount.toFixed(4)}</td>
        </tr>)}</tbody>
      </table></div>
      {invoices.length > 1000 && <p className="muted">{tr(locale, "The detail table shows the newest 1,000 rows; KPI totals include every matching invoice.", "يعرض جدول التفاصيل أحدث 1000 صف، بينما تشمل المؤشرات جميع الفواتير المطابقة.")}</p>}
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Collection Allocations", "تخصيصات التحصيل")}</h2><span>{paymentAllocations.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Received", "الاستلام")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Method", "الطريقة")}</th><th>{tr(locale, "Cashier", "أمين الصندوق")}</th><th>{tr(locale, "Amount", "المبلغ")}</th></tr></thead>
        <tbody>{paymentAllocations.length === 0 ? <tr><td colSpan={5} className="empty-state"><TableEmptyState title={tr(locale, "No collection allocations match the selected filters.", "لا توجد تخصيصات تحصيل تطابق المرشحات المحددة.")} description={tr(locale, "No allocated collections match these filters. Payment method and cashier filters affect collection/refund metrics only.", "لا توجد تحصيلات مخصصة تطابق الفلاتر. تؤثر طريقة الدفع وأمين الصندوق على التحصيل والاسترداد فقط.")} action={{ href: "/billing/reports", label: tr(locale, "Clear filters", "مسح الفلاتر") }} /></td></tr> : paymentAllocations.slice(0, 1000).map((item, index) => <tr key={item.payment.id + ":" + item.invoice.invoiceNumber + ":" + index}>
          <td>{item.payment.receivedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
          <td>{item.invoice.invoiceNumber}</td>
          <td>{locale === "ar" ? item.payment.paymentMethodNameArSnapshot || item.payment.paymentMethodNameEnSnapshot : item.payment.paymentMethodNameEnSnapshot}</td>
          <td>{locale === "ar" ? item.payment.cashier.displayNameAr || item.payment.cashier.displayNameEn : item.payment.cashier.displayNameEn}</td>
          <td>{item.amount.toFixed(4)} {item.payment.currency}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Credit Notes", "الإشعارات الدائنة")}</h2><span>{creditNotes.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Issued", "الإصدار")}</th><th>{tr(locale, "Credit note", "الإشعار")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Amount", "المبلغ")}</th><th>{tr(locale, "Reason", "السبب")}</th></tr></thead>
          <tbody>{creditNotes.length === 0 ? <tr><td colSpan={5} className="empty-state"><TableEmptyState title={tr(locale, "No credit notes match.", "لا توجد إشعارات دائنة مطابقة.")} description={tr(locale, "No credit notes match the selected report scope. Credit notes remain dated at their original issuance time.", "لا توجد إشعارات دائنة ضمن نطاق التقرير المحدد. تحتفظ الإشعارات بتاريخ إصدارها الأصلي.")} action={{ href: "/billing/reports", label: tr(locale, "Clear filters", "مسح الفلاتر") }} /></td></tr> : creditNotes.slice(0, 500).map(item => <tr key={item.id}>
            <td>{item.issuedAt.toISOString().replace("T", " ").slice(0, 19)}</td><td>{item.creditNoteNumber}</td><td>{item.invoice.invoiceNumber}</td><td>{item.amount.toFixed(4)} {item.currency}</td><td>{item.reason}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Refunds", "الاستردادات")}</h2><span>{refunds.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Processed", "التنفيذ")}</th><th>{tr(locale, "Refund", "الاسترداد")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Method", "الطريقة")}</th><th>{tr(locale, "Original cashier", "أمين الصندوق الأصلي")}</th><th>{tr(locale, "Amount", "المبلغ")}</th></tr></thead>
          <tbody>{refunds.length === 0 ? <tr><td colSpan={6} className="empty-state"><TableEmptyState title={tr(locale, "No refunds match.", "لا توجد استردادات مطابقة.")} description={tr(locale, "No refunds match the current report filters. Refund evidence remains in the original financial transaction history.", "لا توجد استردادات تطابق الفلاتر الحالية. تبقى أدلة الاسترداد ضمن سجل الحركات المالية الأصلي.")} action={{ href: "/billing/reports", label: tr(locale, "Clear filters", "مسح الفلاتر") }} /></td></tr> : refunds.slice(0, 500).map(item => <tr key={item.id}>
            <td>{item.processedAt.toISOString().replace("T", " ").slice(0, 19)}</td><td>{item.refundNumber}</td><td>{item.invoice.invoiceNumber}</td><td>{locale === "ar" ? item.paymentMethodNameArSnapshot || item.paymentMethodNameEnSnapshot : item.paymentMethodNameEnSnapshot}</td><td>{locale === "ar" ? item.payment.cashier.displayNameAr || item.payment.cashier.displayNameEn : item.payment.cashier.displayNameEn}</td><td>{item.amount.toFixed(4)} {item.currency}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>
  </main>;
}
