import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

function lineTypeLabel(locale: "ar" | "en", value: string) {
  const labels: Record<string, string> = {
    INVOICE: tr(locale, "Invoice", "فاتورة"),
    CREDIT_NOTE: tr(locale, "Credit note", "إشعار دائن"),
    PAYMENT: tr(locale, "Payment", "دفعة"),
    REFUND: tr(locale, "Refund", "استرداد"),
  };
  return labels[value] || value;
}

export default async function ClientStatementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const { id } = await params;

  const statement = await prisma.clientAccountStatement.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      generatedBy: true,
      lines: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!statement) notFound();

  if (statement.branchId) {
    if (!canAccessBranch(session, statement.branchId)) notFound();
  } else {
    const [activeCount, accessibleCount] = await Promise.all([
      prisma.branch.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
      prisma.userBranchScope.count({
        where: { userId: session.user.id, branch: { organizationId: session.user.organizationId, status: "ACTIVE" } },
      }),
    ]);
    if (accessibleCount !== activeCount) notFound();
  }

  const clientName = locale === "ar" ? statement.clientNameArSnapshot || statement.clientNameEnSnapshot : statement.clientNameEnSnapshot;
  const generatedBy = locale === "ar" ? statement.generatedBy.displayNameAr || statement.generatedBy.displayNameEn : statement.generatedBy.displayNameEn;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Client Account Statement", "كشف حساب العميل")}</p>
        <h1>{statement.statementNumber}</h1>
        <p className="muted">{statement.clientCodeSnapshot} — {clientName} · {statement.currency} · {statement.periodStart.toISOString().slice(0,10)} → {statement.periodEnd.toISOString().slice(0,10)}</p>
      </div>
      <div className="header-actions"><Link className="secondary-link" href="/billing/accounts">{tr(locale, "Back to Client Accounts", "العودة لحسابات العملاء")}</Link></div>
    </header>

    <section className="finance-kpi-grid">
      <article><div><span>{tr(locale, "Opening", "الافتتاحي")}</span><small>{statement.currency}</small></div><strong>{statement.openingBalance.toFixed(4)}</strong></article>
      <article><div><span>{tr(locale, "Charges", "الرسوم")}</span><small>{statement.currency}</small></div><strong>{statement.invoiceCharges.toFixed(4)}</strong></article>
      <article><div><span>{tr(locale, "Credits + Payments", "الدائن + المدفوعات")}</span><small>{statement.currency}</small></div><strong>{statement.creditNotes.add(statement.payments).toFixed(4)}</strong></article>
      <article><div><span>{tr(locale, "Refunds", "الاستردادات")}</span><small>{statement.currency}</small></div><strong>{statement.refunds.toFixed(4)}</strong></article>
      <article><div><span>{tr(locale, "Closing Balance", "الرصيد الختامي")}</span><small>{statement.currency}</small></div><strong>{statement.closingBalance.toFixed(4)}</strong></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr(locale, "Statement Ledger", "حركة كشف الحساب")}</h2><span>{statement.branchCodeSnapshot || tr(locale, "All branches", "جميع الفروع")} · {statement.timezoneSnapshot}</span></div><span className={"status-badge status-" + statement.status.toLowerCase()}>{statusLabel(locale, statement.status)}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Date", "التاريخ")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Reference", "المرجع")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Description", "الوصف")}</th><th>{tr(locale, "Debit", "مدين")}</th><th>{tr(locale, "Credit", "دائن")}</th><th>{tr(locale, "Balance", "الرصيد")}</th></tr></thead>
        <tbody>{statement.lines.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No movements occurred inside this statement period.", "لا توجد حركات ضمن فترة كشف الحساب.")}</td></tr> : statement.lines.map(line => <tr key={line.id}>
          <td>{line.occurredAt.toISOString().slice(0,16).replace("T"," ")}</td><td>{lineTypeLabel(locale, line.lineType)}</td><td>{line.sourceNumber}</td><td>{line.branchCodeSnapshot}</td><td>{line.description}</td>
          <td>{line.debitAmount.gt(0) ? line.debitAmount.toFixed(4) + " " + statement.currency : "—"}</td><td>{line.creditAmount.gt(0) ? line.creditAmount.toFixed(4) + " " + statement.currency : "—"}</td><td><strong>{line.runningBalance.toFixed(4)} {statement.currency}</strong></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Snapshot Metadata", "بيانات اللقطة")}</h2></div>
      <dl className="detail-list">
        <div><dt>{tr(locale, "Generated by", "أنشأه")}</dt><dd>{generatedBy}</dd></div>
        <div><dt>{tr(locale, "Generated at", "وقت الإنشاء")}</dt><dd>{statement.generatedAt.toISOString().slice(0,19).replace("T"," ")}</dd></div>
        <div><dt>{tr(locale, "Payment terms", "شروط الدفع")}</dt><dd>{statement.paymentTermsDaysSnapshot == null ? "—" : statement.paymentTermsDaysSnapshot + " " + tr(locale, "days", "يوم")}</dd></div>
        <div><dt>{tr(locale, "Reporting timezone", "المنطقة الزمنية للتقرير")}</dt><dd>{statement.timezoneSnapshot}</dd></div>
      </dl>
    </section>
  </main>;
}
