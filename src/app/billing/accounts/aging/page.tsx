import { SystemDateField } from "@/components/system-date-field";
import Link from "next/link";
import { agingBucket, aggregateAging, historicalInvoiceReceivable, localCalendarDate, sumMoney4, type AgingBucket } from "@/lib/accounts-receivable-aging";
import { localDateStartUtc, nextDateString } from "@/lib/client-accounting";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

type AgingRow = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  branchCode: string;
  invoiceNumber: string;
  currency: string;
  issuedDate: string;
  dueDate: string | null;
  dueDateBasis: string | null;
  paymentTermsDays: number | null;
  daysOverdue: number | null;
  bucket: AgingBucket | null;
  receivable: string;
  creditBalance: string;
};

function bucketLabel(locale: "ar" | "en", bucket: AgingBucket | null) {
  if (bucket === "CURRENT") return tr(locale, "Current", "غير مستحق");
  if (bucket === "DAYS_1_30") return tr(locale, "1–30 days", "1–30 يوم");
  if (bucket === "DAYS_31_60") return tr(locale, "31–60 days", "31–60 يوم");
  if (bucket === "DAYS_61_90") return tr(locale, "61–90 days", "61–90 يوم");
  if (bucket === "DAYS_91_PLUS") return tr(locale, "91+ days", "91+ يوم");
  return tr(locale, "Unclassified", "غير مصنف");
}

function dueBasisLabel(locale: "ar" | "en", basis: string | null) {
  if (basis === "ISSUANCE_SNAPSHOT") return tr(locale, "Issuance snapshot", "لقطة وقت الإصدار");
  if (basis === "MIGRATED_BASELINE") return tr(locale, "Migrated baseline", "خط أساس مرحّل");
  return tr(locale, "Unknown", "غير معروف");
}

export default async function AccountsReceivableAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; client?: string; currency?: string; asOf?: string }>;
}) {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const params = await searchParams;
  const accessibleScopes = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE");
  const accessibleBranchIds = accessibleScopes.map(scope => scope.branchId);

  const [organization, activeBranchCount, clients] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { defaultTimezone: true },
    }),
    prisma.branch.count({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");

  const hasAllBranches = accessibleBranchIds.length === activeBranchCount;
  const requestedBranch = params.branch || session.activeBranchId || accessibleScopes[0]?.branchId || "";
  const useAllBranches = requestedBranch === "ALL" && hasAllBranches;
  const selectedScope = accessibleScopes.find(scope => scope.branchId === requestedBranch) || accessibleScopes[0] || null;
  const branchIds = useAllBranches ? accessibleBranchIds : selectedScope ? [selectedScope.branchId] : [];
  const timezone = useAllBranches ? organization.defaultTimezone : selectedScope?.branch.timezone || organization.defaultTimezone;

  const defaultAsOf = localCalendarDate(new Date(), timezone) || new Date().toISOString().slice(0, 10);
  const requestedAsOf = params.asOf || defaultAsOf;
  const requestedNextDay = nextDateString(requestedAsOf);
  const requestedEndExclusive = requestedNextDay ? localDateStartUtc(requestedNextDay, timezone) : null;
  const asOfDate = requestedEndExclusive ? requestedAsOf : defaultAsOf;
  const nextDay = nextDateString(asOfDate)!;
  const endExclusive = localDateStartUtc(nextDay, timezone);
  if (!endExclusive) throw new Error("AGING_DATE_BOUNDARY_FAILED");

  const clientId = params.client && clients.some(client => client.id === params.client) ? params.client : "";
  const currency = /^[A-Za-z]{3}$/.test(params.currency || "") ? (params.currency || "").toUpperCase() : "";

  const invoices = branchIds.length === 0 ? [] : await prisma.invoice.findMany({
    where: {
      organizationId: session.user.organizationId,
      branchId: { in: branchIds },
      clientId: { not: null },
      status: { not: "VOID" },
      issuedAt: { lt: endExclusive },
      ...(clientId ? { clientId } : {}),
      ...(currency ? { currency } : {}),
    },
    include: {
      client: true,
      branch: true,
      creditNotes: {
        where: { status: "ISSUED", issuedAt: { lt: endExclusive } },
        select: { amount: true },
      },
      allocations: {
        where: {
          payment: {
            status: { not: "VOIDED" },
            receivedAt: { lt: endExclusive },
          },
        },
        select: { amount: true },
      },
      refunds: {
        where: { status: "POSTED", processedAt: { lt: endExclusive } },
        select: { amount: true },
      },
    },
    orderBy: [{ currency: "asc" }, { issuedAt: "asc" }],
  });

  const rows: AgingRow[] = [];
  for (const invoice of invoices) {
    if (!invoice.client) continue;
    const zero = invoice.total.mul(0);
    const creditNotes = invoice.creditNotes.reduce((sum, item) => sum.add(item.amount), zero);
    const payments = invoice.allocations.reduce((sum, item) => sum.add(item.amount), zero);
    const refunds = invoice.refunds.reduce((sum, item) => sum.add(item.amount), zero);
    const financial = historicalInvoiceReceivable({
      total: invoice.total.toFixed(4),
      creditNotes: creditNotes.toFixed(4),
      payments: payments.toFixed(4),
      refunds: refunds.toFixed(4),
    });
    if (!financial || (financial.receivable === "0.0000" && financial.creditBalance === "0.0000")) continue;

    const dueDate = invoice.dueDate?.toISOString().slice(0, 10) || null;
    const classification = dueDate ? agingBucket(dueDate, asOfDate) : null;
    rows.push({
      id: invoice.id,
      clientId: invoice.client.id,
      clientCode: invoice.client.code,
      clientName: locale === "ar" ? invoice.client.nameAr || invoice.client.nameEn : invoice.client.nameEn,
      branchCode: invoice.branch.code,
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      issuedDate: invoice.issuedAt.toISOString().slice(0, 10),
      dueDate,
      dueDateBasis: invoice.dueDateBasis,
      paymentTermsDays: invoice.paymentTermsDaysSnapshot,
      daysOverdue: classification?.daysOverdue ?? null,
      bucket: classification?.bucket ?? null,
      receivable: financial.receivable,
      creditBalance: financial.creditBalance,
    });
  }

  const currencies = [...new Set(rows.map(row => row.currency))].sort();
  const currencySummaries = currencies.map(code => {
    const currencyRows = rows.filter(row => row.currency === code);
    const classified = currencyRows.filter((row): row is AgingRow & { bucket: AgingBucket } => row.bucket !== null);
    const aging = aggregateAging(classified.map(row => ({
      bucket: row.bucket,
      receivable: row.receivable,
      creditBalance: row.creditBalance,
    })));
    const unclassified = sumMoney4(currencyRows.filter(row => row.bucket === null).map(row => row.receivable)) || "0.0000";
    const allCreditBalances = sumMoney4(currencyRows.map(row => row.creditBalance)) || "0.0000";
    const classifiedReceivable = aging?.receivableTotal || "0.0000";
    const totalReceivable = sumMoney4([classifiedReceivable, unclassified]) || "0.0000";
    return {
      currency: code,
      current: aging?.current || "0.0000",
      days1to30: aging?.days1to30 || "0.0000",
      days31to60: aging?.days31to60 || "0.0000",
      days61to90: aging?.days61to90 || "0.0000",
      days91plus: aging?.days91plus || "0.0000",
      unclassified,
      receivableTotal: totalReceivable,
      creditBalanceTotal: allCreditBalances,
    };
  });

  const clientSummaryMap = new Map<string, {
    clientId: string;
    clientCode: string;
    clientName: string;
    currency: string;
    rows: AgingRow[];
  }>();
  for (const row of rows) {
    const key = row.clientId + "|" + row.currency;
    const current = clientSummaryMap.get(key) || {
      clientId: row.clientId,
      clientCode: row.clientCode,
      clientName: row.clientName,
      currency: row.currency,
      rows: [],
    };
    current.rows.push(row);
    clientSummaryMap.set(key, current);
  }

  const clientSummaries = [...clientSummaryMap.values()].map(group => {
    const classified = group.rows.filter((row): row is AgingRow & { bucket: AgingBucket } => row.bucket !== null);
    const aging = aggregateAging(classified.map(row => ({
      bucket: row.bucket,
      receivable: row.receivable,
      creditBalance: row.creditBalance,
    })));
    const unclassified = sumMoney4(group.rows.filter(row => row.bucket === null).map(row => row.receivable)) || "0.0000";
    const creditBalance = sumMoney4(group.rows.map(row => row.creditBalance)) || "0.0000";
    const receivable = sumMoney4([aging?.receivableTotal || "0.0000", unclassified]) || "0.0000";
    return {
      ...group,
      current: aging?.current || "0.0000",
      days1to30: aging?.days1to30 || "0.0000",
      days31to60: aging?.days31to60 || "0.0000",
      days61to90: aging?.days61to90 || "0.0000",
      days91plus: aging?.days91plus || "0.0000",
      unclassified,
      receivable,
      creditBalance,
    };
  }).sort((a, b) => a.clientName.localeCompare(b.clientName) || a.currency.localeCompare(b.currency));

  const hasUnclassified = rows.some(row => row.bucket === null && row.receivable !== "0.0000");
  const selectedBranchValue = useAllBranches ? "ALL" : selectedScope?.branchId || "";

  return <main className="catalog-shell filter-workspace">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Accounts Receivable Aging", "أعمار الذمم المدينة")}</h1>
        <p className="muted">{tr(locale, "Historical aging is reconstructed as of the selected date from invoices, credit notes, payment allocations and refunds.", "يتم إعادة بناء أعمار الذمم تاريخيًا حتى التاريخ المحدد من الفواتير والإشعارات الدائنة وتخصيصات المدفوعات والاستردادات.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/billing/accounts">{tr(locale, "Client Accounts", "حسابات العملاء")}</Link>
        <Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link>
      </div>
    </header>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr(locale, "Aging Filters", "مرشحات أعمار الذمم")}</h2><span>{tr(locale, "Amounts are never combined across currencies.", "لا يتم جمع المبالغ بين العملات المختلفة.")}</span></div></div>
      <form className="catalog-form filter-grid" action="/billing/accounts/aging" method="get">
        <label>{tr(locale, "Branch scope", "نطاق الفرع")}
          <select name="branch" defaultValue={selectedBranchValue}>
            {hasAllBranches && <option value="ALL">{tr(locale, "All organization branches", "جميع فروع المؤسسة")}</option>}
            {accessibleScopes.map(scope => <option key={scope.branchId} value={scope.branchId}>{scope.branch.code} — {locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn}</option>)}
          </select>
        </label>
        <label>{tr(locale, "Client", "العميل")}
          <select name="client" defaultValue={clientId}>
            <option value="">{tr(locale, "All clients", "جميع العملاء")}</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.code} — {locale === "ar" ? client.nameAr || client.nameEn : client.nameEn}</option>)}
          </select>
        </label>
        <label>{tr(locale, "Currency", "العملة")}<input name="currency" maxLength={3} defaultValue={currency} placeholder={tr(locale, "All", "الكل")} /></label>
        <label>{tr(locale, "As of date", "كما في تاريخ")}<SystemDateField name="asOf" defaultValue={asOfDate} required /></label>
        <button className="primary-button form-span">{tr(locale, "Apply Aging", "تطبيق أعمار الذمم")}</button>
      </form>
    </section>

    {hasUnclassified && <section className="table-card detail-section">
      <div className="form-error">{tr(locale, "One or more historical client invoices have no due-date snapshot. Their receivable is shown as unclassified instead of being silently placed in an aging bucket.", "توجد فاتورة عميل تاريخية واحدة أو أكثر بلا لقطة لتاريخ الاستحقاق. يظهر رصيدها كغير مصنف بدل وضعه بصمت ضمن شريحة زمنية غير صحيحة.")}</div>
    </section>}

    <section className="finance-kpi-grid">
      {currencySummaries.map(summary => <article key={summary.currency}>
        <div><span>{summary.currency}</span><small>{tr(locale, "As of", "كما في")} {asOfDate}</small></div>
        <dl>
          <div><dt>{tr(locale, "Current", "غير مستحق")}</dt><dd>{summary.current}</dd></div>
          <div><dt>{tr(locale, "1–30", "1–30")}</dt><dd>{summary.days1to30}</dd></div>
          <div><dt>{tr(locale, "31–60", "31–60")}</dt><dd>{summary.days31to60}</dd></div>
          <div><dt>{tr(locale, "61–90", "61–90")}</dt><dd>{summary.days61to90}</dd></div>
          <div><dt>{tr(locale, "91+", "91+")}</dt><dd>{summary.days91plus}</dd></div>
          {summary.unclassified !== "0.0000" && <div><dt>{tr(locale, "Unclassified", "غير مصنف")}</dt><dd>{summary.unclassified}</dd></div>}
          <div><dt>{tr(locale, "Receivable", "إجمالي الذمم")}</dt><dd className="finance-due">{summary.receivableTotal}</dd></div>
          <div><dt>{tr(locale, "Credit balance", "رصيد دائن للعميل")}</dt><dd>{summary.creditBalanceTotal}</dd></div>
        </dl>
      </article>)}
      {currencySummaries.length === 0 && <article><div><span>{tr(locale, "No outstanding receivables", "لا توجد ذمم مستحقة")}</span><small>{tr(locale, "for the selected filters", "ضمن المرشحات المحددة")}</small></div></article>}
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><div><h2>{tr(locale, "Client Aging Summary", "ملخص أعمار الذمم حسب العميل")}</h2><span>{clientSummaries.length} {tr(locale, "client/currency rows", "صف عميل/عملة")}</span></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Client", "العميل")}</th><th>{tr(locale, "Currency", "العملة")}</th><th>{tr(locale, "Current", "غير مستحق")}</th><th>{tr(locale, "1–30", "1–30")}</th><th>{tr(locale, "31–60", "31–60")}</th><th>{tr(locale, "61–90", "61–90")}</th><th>{tr(locale, "91+", "91+")}</th><th>{tr(locale, "Unclassified", "غير مصنف")}</th><th>{tr(locale, "Receivable", "الذمم")}</th><th>{tr(locale, "Credit balance", "رصيد دائن")}</th></tr></thead>
        <tbody>{clientSummaries.length === 0 ? <tr><td colSpan={10} className="empty-state">{tr(locale, "No client receivables for the selected date and filters.", "لا توجد ذمم عملاء للتاريخ والمرشحات المحددة.")}</td></tr> : clientSummaries.map(summary => <tr key={summary.clientId + summary.currency}>
          <td><strong>{summary.clientCode}</strong><br/><small>{summary.clientName}</small></td><td>{summary.currency}</td><td>{summary.current}</td><td>{summary.days1to30}</td><td>{summary.days31to60}</td><td>{summary.days61to90}</td><td>{summary.days91plus}</td><td>{summary.unclassified}</td><td><strong>{summary.receivable}</strong></td><td>{summary.creditBalance}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><div><h2>{tr(locale, "Invoice Aging Detail", "تفاصيل أعمار الفواتير")}</h2><span>{rows.length} {tr(locale, "open or credit-balance invoices", "فاتورة مفتوحة أو ذات رصيد دائن")}</span></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Client", "العميل")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Issued", "الإصدار")}</th><th>{tr(locale, "Terms", "الشروط")}</th><th>{tr(locale, "Due date", "تاريخ الاستحقاق")}</th><th>{tr(locale, "Due-date basis", "أساس تاريخ الاستحقاق")}</th><th>{tr(locale, "Days overdue", "أيام التأخير")}</th><th>{tr(locale, "Bucket", "الشريحة")}</th><th>{tr(locale, "Receivable", "الذمم")}</th><th>{tr(locale, "Credit balance", "الرصيد الدائن")}</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={11} className="empty-state">{tr(locale, "No invoice balances to age.", "لا توجد أرصدة فواتير لحساب أعمارها.")}</td></tr> : rows.map(row => <tr key={row.id}>
          <td><strong>{row.invoiceNumber}</strong><br/><small>{row.currency}</small></td><td>{row.clientCode} — {row.clientName}</td><td>{row.branchCode}</td><td>{row.issuedDate}</td><td>{row.paymentTermsDays == null ? "—" : row.paymentTermsDays + " " + tr(locale, "days", "يوم")}</td><td>{row.dueDate || "—"}</td><td>{dueBasisLabel(locale, row.dueDateBasis)}</td><td>{row.daysOverdue == null ? "—" : row.daysOverdue}</td><td>{bucketLabel(locale, row.bucket)}</td><td>{row.receivable} {row.currency}</td><td>{row.creditBalance} {row.currency}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
