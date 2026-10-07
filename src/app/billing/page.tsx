import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentCreateModal } from "@/components/payment-create-modal";
import { SystemIcon } from "@/components/system-icon";
import { statusLabel, tr } from "@/lib/ui-i18n";
import { DiscountApprovalManager } from "@/components/discount-approval-manager";
import { effectiveDiscountLimit } from "@/lib/discount-policy";
import { CreditNoteCreateModal, RefundCreateModal } from "@/components/billing-adjustment-modals";

export const dynamic = "force-dynamic";

function discountRequestContext(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { patientNumber: "—", services: "—" };
  }
  const record = value as Record<string, unknown>;
  const patientNumber = typeof record.patientNumber === "string" ? record.patientNumber : "—";
  const rows = [
    ...(Array.isArray(record.directTests) ? record.directTests : []),
    ...(Array.isArray(record.packages) ? record.packages : []),
  ];
  const services = rows
    .map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const entry = item as Record<string, unknown>;
      const code = typeof entry.code === "string" ? entry.code : "";
      const name = typeof entry.name === "string" ? entry.name : "";
      return [code, name].filter(Boolean).join(" — ");
    })
    .filter(Boolean)
    .join(", ");
  return { patientNumber, services: services || "—" };
}

export default async function BillingPage() {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";

  const accessibleBranchIds = session.user.branchScopes.map(scope => scope.branchId);
  const permissions = permissionSet(session);
  const canManageBilling = permissions.has("billing.manage");
  const canApproveDiscounts = permissions.has("billing.discount.approve");
  const approverLimitPercent = effectiveDiscountLimit({
    userOverride: session.user.discountLimitPercent,
    roleLimits: session.user.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .map(assignment => assignment.role.discountLimitPercent),
  });

  const [invoices, recentPayments, discountApprovals, creditNotes, recentRefunds] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: accessibleBranchIds } },
      include: {
        order: { include: { patient: true } },
        client: true,
        branch: true,
        discountApprovedBy: true,
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
        refunds: { where: { status: "POSTED" }, select: { invoiceId: true, amount: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    canApproveDiscounts ? prisma.discountApprovalRequest.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: accessibleBranchIds },
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      include: {
        branch: true,
        requestedBy: true,
      },
      orderBy: { requestedAt: "asc" },
      take: 100,
    }) : Promise.resolve([]),
    prisma.creditNote.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: accessibleBranchIds } },
      include: { branch: true, invoice: true, issuedBy: true },
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
    prisma.refund.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: accessibleBranchIds } },
      include: { branch: true, invoice: true, payment: true, processedBy: true },
      orderBy: { processedAt: "desc" },
      take: 100,
    }),
  ]);

  const openInvoices = invoices.filter(invoice => invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID");
  const creditableInvoices = invoices
    .filter(invoice => ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status) && invoice.creditedAmount.lt(invoice.total))
    .map(invoice => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      remainingCredit: invoice.total.sub(invoice.creditedAmount).toFixed(4),
      balanceAmount: invoice.balanceAmount.toFixed(4),
    }));
  const refundOptions = recentPayments.flatMap(payment => {
    if (payment.status !== "POSTED") return [];
    return payment.allocations.flatMap(allocation => {
      const refunded = payment.refunds
        .filter(refund => refund.invoiceId === allocation.invoiceId)
        .reduce((sum, refund) => sum.add(refund.amount), allocation.amount.mul(0));
      const remaining = allocation.amount.sub(refunded);
      if (remaining.lte(0)) return [];
      return [{
        paymentId: payment.id,
        invoiceId: allocation.invoiceId,
        invoiceNumber: allocation.invoice.invoiceNumber,
        currency: payment.currency,
        remainingRefundable: remaining.toFixed(4),
        receivedAt: payment.receivedAt.toISOString(),
        method: payment.method,
      }];
    });
  });
  const totals = new Map<string, { invoiced: number; credited: number; paid: number; balance: number }>();
  for (const invoice of invoices) {
    if (invoice.status === "VOID") continue;
    const row = totals.get(invoice.currency) || { invoiced: 0, credited: 0, paid: 0, balance: 0 };
    row.invoiced += invoice.total.toNumber();
    row.credited += invoice.creditedAmount.toNumber();
    row.paid += invoice.paidAmount.toNumber();
    row.balance += invoice.balanceAmount.toNumber();
    totals.set(invoice.currency, row);
  }

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="billing" size={25} />{tr(locale, "Invoices & Payments", "الفواتير والمدفوعات")}</h1>
        <p className="muted">{tr(locale, "Historical invoice values are stored as immutable snapshots. Payments are allocated separately and support partial settlement.", "يتم حفظ قيم الفواتير التاريخية كلقطات غير قابلة للتغيير، وتُسجل المدفوعات بشكل منفصل مع دعم السداد الجزئي.")}</p>
      </div>
      <div className="header-actions">
        {canManageBilling && <PaymentCreateModal locale={locale} invoices={openInvoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          balanceAmount: invoice.balanceAmount.toString(),
        }))} />}
        {canManageBilling && <CreditNoteCreateModal locale={locale} invoices={creditableInvoices} />}
        {canManageBilling && <RefundCreateModal locale={locale} options={refundOptions} />}
        {(canManageBilling || permissions.has("billing.cashier.approve")) && <Link className="secondary-link" href="/billing/cashier">{tr(locale, "Cashier Closing", "إغلاق أمين الصندوق")}</Link>}
        <Link className="secondary-link" href="/orders"><SystemIcon name="orders" size={15} />{tr(locale, "Orders", "الطلبات")}</Link>
        <Link className="secondary-link" href="/pricing"><SystemIcon name="pricing" size={15} />{tr(locale, "Pricing", "الأسعار")}</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="finance-kpi-grid">
      {[...totals.entries()].map(([currency, row]) => <article key={currency}>
        <div><span>{currency}</span><small>{tr(locale, "Current invoice set", "مجموعة الفواتير الحالية")}</small></div>
        <dl>
          <div><dt>{tr(locale, "Invoiced", "إجمالي الفواتير")}</dt><dd>{row.invoiced.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
          <div><dt>{tr(locale, "Credited", "الإشعارات الدائنة")}</dt><dd>{row.credited.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
          <div><dt>{tr(locale, "Net paid", "صافي المدفوع")}</dt><dd>{row.paid.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
          <div><dt>{tr(locale, "Outstanding", "المتبقي")}</dt><dd className={row.balance > 0 ? "finance-due" : ""}>{row.balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
        </dl>
      </article>)}
    </section>

    {canApproveDiscounts && <DiscountApprovalManager
      locale={locale}
      approverLimitPercent={approverLimitPercent}
      approvals={discountApprovals.map(item => {
        const context = discountRequestContext(item.contextSnapshot);
        return {
        id: item.id,
        branchCode: item.branch.code,
        branchName: locale === "ar" ? item.branch.nameAr || item.branch.nameEn : item.branch.nameEn,
        requesterName: locale === "ar" ? item.requestedBy.displayNameAr || item.requestedBy.displayNameEn : item.requestedBy.displayNameEn,
        patientNumber: context.patientNumber,
        services: context.services,
        discountPercent: item.discountPercent.toString(),
        reason: item.reason,
        currency: item.currency,
        subtotal: item.subtotalSnapshot.toString(),
        discountTotal: item.discountTotalSnapshot.toString(),
        finalTotal: item.finalTotalSnapshot.toString(),
        requestedAt: item.requestedAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
      };
      })}
    />}

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr(locale, "Invoices", "الفواتير")}</h2><span>{invoices.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Order", "الطلب")}</th><th>{tr(locale, "Patient / Client", "المريض / العميل")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Subtotal", "الإجمالي قبل الخصم")}</th><th>{tr(locale, "Discount", "الخصم")}</th><th>{tr(locale, "Credited", "الدائن")}</th><th>{tr(locale, "Total", "الإجمالي")}</th><th>{tr(locale, "Net paid", "صافي المدفوع")}</th><th>{tr(locale, "Balance", "الرصيد")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>
            {invoices.length === 0 ? <tr><td colSpan={11} className="empty-state">{tr(locale, "No invoices yet.", "لا توجد فواتير بعد.")}</td></tr> :
              invoices.map(invoice => <tr key={invoice.id}>
                <td><strong>{invoice.invoiceNumber}</strong><br/><small>{invoice.issuedAt.toISOString().slice(0,16).replace("T"," ")}</small></td>
                <td>{invoice.order?.accessionNumber || "—"}</td>
                <td>{invoice.client?.nameEn || invoice.order?.patient.fullNameEn || "—"}</td>
                <td>{invoice.branch.code}</td>
                <td>{invoice.subtotal.toString()} {invoice.currency}</td>
                <td>{invoice.discountTotal.toNumber() > 0 ? <><strong>{invoice.discountTotal.toString()} {invoice.currency}</strong><br/><small>{invoice.discountPercent.toString()}% · {invoice.discountReason || "—"}{invoice.discountApprovedBy ? " · " + (locale === "ar" ? invoice.discountApprovedBy.displayNameAr || invoice.discountApprovedBy.displayNameEn : invoice.discountApprovedBy.displayNameEn) : ""}</small></> : "—"}</td>
                <td>{invoice.creditedAmount.toString()} {invoice.currency}</td>
                <td>{invoice.total.toString()} {invoice.currency}</td>
                <td>{invoice.paidAmount.toString()} {invoice.currency}</td>
                <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
                <td><span className={"status-badge status-" + invoice.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, invoice.status)}</span></td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Recent Payments", "أحدث المدفوعات")}</h2><span>{recentPayments.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Date", "التاريخ")}</th><th>{tr(locale, "Invoice(s)", "الفاتورة/الفواتير")}</th><th>{tr(locale, "Original amount", "المبلغ الأصلي")}</th><th>{tr(locale, "Refunded", "المسترد")}</th><th>{tr(locale, "Net", "الصافي")}</th><th>{tr(locale, "Method", "الطريقة")}</th><th>{tr(locale, "Reference", "المرجع")}</th><th>{tr(locale, "Cashier", "أمين الصندوق")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>
            {recentPayments.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No payments posted yet.", "لا توجد مدفوعات مسجلة بعد.")}</td></tr> :
              recentPayments.map(payment => <tr key={payment.id}>
                <td>{payment.receivedAt.toISOString().slice(0,16).replace("T"," ")}</td>
                <td>{payment.allocations.map(a => a.invoice.invoiceNumber).join(", ") || "—"}</td>
                <td>{payment.amount.toString()} {payment.currency}</td>
                <td>{payment.refundedAmount.toString()} {payment.currency}</td>
                <td>{payment.amount.sub(payment.refundedAmount).toString()} {payment.currency}</td>
                <td>{payment.method}</td>
                <td>{payment.reference || "—"}</td>
                <td>{payment.cashier.displayNameEn}</td>
                <td><span className={"status-badge status-" + payment.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, payment.status)}</span></td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Credit Notes", "الإشعارات الدائنة")}</h2><span>{creditNotes.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Date", "التاريخ")}</th><th>{tr(locale, "Credit note", "الإشعار الدائن")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Amount", "المبلغ")}</th><th>{tr(locale, "Reason", "السبب")}</th><th>{tr(locale, "Issued by", "أصدره")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{creditNotes.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No credit notes issued yet.", "لا توجد إشعارات دائنة صادرة بعد.")}</td></tr> :
          creditNotes.map(note => <tr key={note.id}>
            <td>{note.issuedAt.toISOString().slice(0,16).replace("T"," ")}</td>
            <td><strong>{note.creditNoteNumber}</strong></td>
            <td>{note.invoice.invoiceNumber}</td>
            <td>{note.branch.code}</td>
            <td>{note.amount.toString()} {note.currency}</td>
            <td>{note.reason}</td>
            <td>{locale === "ar" ? note.issuedBy.displayNameAr || note.issuedBy.displayNameEn : note.issuedBy.displayNameEn}</td>
            <td><span className={"status-badge status-" + note.status.toLowerCase()}>{statusLabel(locale, note.status)}</span></td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Refunds", "الاستردادات")}</h2><span>{recentRefunds.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Date", "التاريخ")}</th><th>{tr(locale, "Refund", "الاسترداد")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Method", "الطريقة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Amount", "المبلغ")}</th><th>{tr(locale, "Reason", "السبب")}</th><th>{tr(locale, "Reference", "المرجع")}</th><th>{tr(locale, "Processed by", "نفذه")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{recentRefunds.length === 0 ? <tr><td colSpan={10} className="empty-state">{tr(locale, "No refunds posted yet.", "لا توجد عمليات استرداد مسجلة بعد.")}</td></tr> :
          recentRefunds.map(refund => <tr key={refund.id}>
            <td>{refund.processedAt.toISOString().slice(0,16).replace("T"," ")}</td>
            <td><strong>{refund.refundNumber}</strong></td>
            <td>{refund.invoice.invoiceNumber}</td>
            <td>{refund.method}</td>
            <td>{refund.branch.code}</td>
            <td>{refund.amount.toString()} {refund.currency}</td>
            <td>{refund.reason}</td>
            <td>{refund.reference || "—"}</td>
            <td>{locale === "ar" ? refund.processedBy.displayNameAr || refund.processedBy.displayNameEn : refund.processedBy.displayNameEn}</td>
            <td><span className={"status-badge status-" + refund.status.toLowerCase()}>{statusLabel(locale, refund.status)}</span></td>
          </tr>)}
        </tbody>
      </table></div>
    </section>
  </main>;
}
