"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type ClientOption = {
  id: string;
  code: string;
  name: string;
  paymentTermsDays: number | null;
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
  defaultCurrency: string;
};

type InvoiceOption = {
  id: string;
  clientId: string;
  branchId: string;
  branchCode: string;
  invoiceNumber: string;
  currency: string;
  balanceAmount: string;
  issuedAt: string;
};

type StatementRow = {
  id: string;
  statementNumber: string;
  clientName: string;
  clientCode: string;
  branchLabel: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  invoiceCharges: string;
  creditNotes: string;
  payments: string;
  refunds: string;
  closingBalance: string;
  generatedAt: string;
  status: string;
};

function errorText(locale: "ar" | "en", code: string) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const map: Record<string, string> = {
    invalid_fields: tr("Complete all required fields.", "أكمل جميع الحقول المطلوبة."),
    client_not_found: tr("Client account was not found.", "لم يتم العثور على حساب العميل."),
    branch_forbidden: tr("You do not have access to this branch.", "ليس لديك صلاحية الوصول إلى هذا الفرع."),
    organization_scope_incomplete: tr("Organization-wide statements require access to every active branch.", "كشف الحساب على مستوى المؤسسة يتطلب صلاحية الوصول إلى جميع الفروع النشطة."),
    invalid_period_timezone: tr("The selected period could not be resolved in the reporting timezone.", "تعذر تحديد الفترة المختارة ضمن المنطقة الزمنية للتقرير."),
    invalid_invoice_allocation_scope: tr("One or more invoices no longer match this client, branch or currency.", "فاتورة واحدة أو أكثر لم تعد مطابقة للعميل أو الفرع أو العملة."),
    duplicate_invoice_allocation: tr("The same invoice cannot be allocated twice.", "لا يمكن تخصيص الدفعة لنفس الفاتورة مرتين."),
    allocation_exceeds_invoice_balance: tr("An allocation exceeds the invoice balance.", "أحد التخصيصات يتجاوز رصيد الفاتورة."),
    allocation_total_mismatch: tr("Allocated amounts must equal the payment amount.", "يجب أن يساوي مجموع التخصيصات مبلغ الدفعة."),
    cashier_shift_required: tr("Open a cashier shift for this branch and currency first.", "افتح وردية أمين صندوق لهذا الفرع وهذه العملة أولاً."),
    cashier_shift_changed: tr("The cashier shift changed while posting. Refresh and try again.", "تغيرت وردية أمين الصندوق أثناء التسجيل. حدّث الصفحة وحاول مجددًا."),
    invoice_changed: tr("An invoice changed while posting. Refresh and review balances.", "تغيرت إحدى الفواتير أثناء التسجيل. حدّث الصفحة وراجع الأرصدة."),
    invoice_allocation_changed: tr("One or more invoice balances changed. Refresh and try again.", "تغير رصيد فاتورة واحدة أو أكثر. حدّث الصفحة وحاول مجددًا."),
  };
  return map[code] || code || tr("Unable to complete the account action.", "تعذر إكمال إجراء حساب العميل.");
}

export function ClientAccountManager({
  locale,
  canManage,
  hasAllBranches,
  defaultBranchId,
  clients,
  branches,
  invoices,
  statements,
}: {
  locale: "ar" | "en";
  canManage: boolean;
  hasAllBranches: boolean;
  defaultBranchId: string | null;
  clients: ClientOption[];
  branches: BranchOption[];
  invoices: InvoiceOption[];
  statements: StatementRow[];
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [statementOpen, setStatementOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentClientId, setPaymentClientId] = useState("");
  const [paymentBranchId, setPaymentBranchId] = useState(defaultBranchId || branches[0]?.id || "");
  const [paymentCurrency, setPaymentCurrency] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const paymentInvoices = useMemo(() => invoices.filter(invoice =>
    invoice.clientId === paymentClientId
    && invoice.branchId === paymentBranchId
    && (!paymentCurrency || invoice.currency === paymentCurrency)
  ), [invoices, paymentClientId, paymentBranchId, paymentCurrency]);

  const availableCurrencies = useMemo(() =>
    [...new Set(invoices.filter(invoice => invoice.clientId === paymentClientId && invoice.branchId === paymentBranchId).map(invoice => invoice.currency))].sort(),
  [invoices, paymentClientId, paymentBranchId]);

  const allocatedTotal = useMemo(() => Object.values(allocations).reduce((sum, value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0), [allocations]);

  function resetPaymentContext(nextClientId?: string) {
    setPaymentClientId(nextClientId || "");
    setPaymentCurrency("");
    setAllocations({});
  }

  async function generateStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/billing/client-statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: form.get("clientId"),
        branchId: form.get("branchId"),
        currency: form.get("currency"),
        periodStart: form.get("periodStart"),
        periodEnd: form.get("periodEnd"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${tr("Statement issued", "تم إصدار كشف الحساب")} · ${body.statementNumber} · ${tr("Closing balance", "الرصيد الختامي")}: ${body.closingBalance}`);
      setStatementOpen(false);
      router.refresh();
    } else setMessage(errorText(locale, body.error || ""));
    setBusy(false);
  }

  async function postClientPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedAllocations = paymentInvoices
      .map(invoice => ({ invoiceId: invoice.id, amount: allocations[invoice.id] || "" }))
      .filter(item => Number(item.amount) > 0);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/billing/client-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: paymentClientId,
        branchId: paymentBranchId,
        currency: paymentCurrency,
        amount: form.get("amount"),
        method: form.get("method"),
        reference: form.get("reference"),
        allocations: selectedAllocations,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${tr("Client payment posted", "تم تسجيل دفعة العميل")} · ${body.amount} ${paymentCurrency} · ${body.allocationCount} ${tr("invoice(s)", "فاتورة")}`);
      setPaymentOpen(false);
      resetPaymentContext();
      router.refresh();
    } else setMessage(errorText(locale, body.error || ""));
    setBusy(false);
  }

  return <div className="admin-grid">
    <div className="admin-page-actions">
      {message && <span className="crud-success-toast">{message}</span>}
      {canManage && <button type="button" className="primary-button" onClick={() => setStatementOpen(true)}>{tr("Generate Statement", "إصدار كشف حساب")}</button>}
      {canManage && <button type="button" className="secondary-button" onClick={() => setPaymentOpen(true)}>{tr("Post Client Payment", "تسجيل دفعة عميل")}</button>}
    </div>

    <CrudModal open={statementOpen} onClose={() => setStatementOpen(false)} title={tr("Generate client account statement", "إصدار كشف حساب عميل")} description={tr("The generated statement is stored as an immutable financial snapshot.", "يتم حفظ كشف الحساب الناتج كلقطة مالية تاريخية ثابتة.")} size="md">
      <form className="catalog-form" onSubmit={generateStatement}>
        <label className="form-span">{tr("Client", "العميل")}<select name="clientId" required defaultValue=""><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}</select></label>
        <label>{tr("Branch scope", "نطاق الفرع")}<select name="branchId" required defaultValue={defaultBranchId || branches[0]?.id || ""}>{hasAllBranches && <option value="">{tr("All organization branches", "جميع فروع المؤسسة")}</option>}{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select></label>
        <label>{tr("Currency", "العملة")}<input name="currency" minLength={3} maxLength={3} required placeholder="EGP" /></label>
        <label>{tr("Period start", "بداية الفترة")}<input name="periodStart" type="date" required /></label>
        <label>{tr("Period end", "نهاية الفترة")}<input name="periodEnd" type="date" required /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Generating…", "جارٍ الإصدار…") : tr("Generate Statement", "إصدار كشف الحساب")}</button>
      </form>
    </CrudModal>

    <CrudModal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={tr("Post client payment", "تسجيل دفعة عميل")} description={tr("Allocate one received payment across multiple open invoices in the same branch and currency.", "وزّع دفعة مستلمة واحدة على عدة فواتير مفتوحة ضمن نفس الفرع والعملة.")} size="xl">
      <form className="catalog-form" onSubmit={postClientPayment}>
        <label>{tr("Client", "العميل")}<select required value={paymentClientId} onChange={event => resetPaymentContext(event.target.value)}><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}</select></label>
        <label>{tr("Branch", "الفرع")}<select required value={paymentBranchId} onChange={event => { setPaymentBranchId(event.target.value); setPaymentCurrency(""); setAllocations({}); }}>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select></label>
        <label>{tr("Currency", "العملة")}<select required value={paymentCurrency} onChange={event => { setPaymentCurrency(event.target.value); setAllocations({}); }}><option value="">{tr("Select currency…", "اختر العملة…")}</option>{availableCurrencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <label>{tr("Payment amount", "مبلغ الدفعة")}<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
        <label>{tr("Method", "طريقة الدفع")}<select name="method" defaultValue="BANK_TRANSFER"><option value="CASH">{tr("Cash", "نقدي")}</option><option value="CARD">{tr("Card", "بطاقة")}</option><option value="BANK_TRANSFER">{tr("Bank transfer", "تحويل بنكي")}</option><option value="ONLINE">{tr("Online", "إلكتروني")}</option><option value="OTHER">{tr("Other", "أخرى")}</option></select></label>
        <label>{tr("Reference", "المرجع")}<input name="reference" maxLength={150} /></label>

        <div className="form-span table-wrap">
          <table>
            <thead><tr><th>{tr("Invoice", "الفاتورة")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Date", "التاريخ")}</th><th>{tr("Balance", "الرصيد")}</th><th>{tr("Allocate", "التخصيص")}</th></tr></thead>
            <tbody>{paymentClientId && paymentCurrency && paymentInvoices.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr("No open invoices for this client, branch and currency.", "لا توجد فواتير مفتوحة لهذا العميل والفرع والعملة.")}</td></tr> : paymentInvoices.map(invoice => <tr key={invoice.id}>
              <td><strong>{invoice.invoiceNumber}</strong></td><td>{invoice.branchCode}</td><td>{invoice.issuedAt.slice(0,10)}</td><td>{invoice.balanceAmount} {invoice.currency}</td>
              <td><input aria-label={tr("Allocation amount", "مبلغ التخصيص")} type="number" min="0" max={invoice.balanceAmount} step="0.0001" value={allocations[invoice.id] || ""} onChange={event => setAllocations(current => ({ ...current, [invoice.id]: event.target.value }))} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="form-span form-success">{tr("Allocated total", "إجمالي التخصيص")}: {allocatedTotal.toFixed(4)} {paymentCurrency}</div>
        <button className="primary-button form-span" disabled={busy || !paymentClientId || !paymentCurrency || paymentInvoices.length === 0}>{busy ? tr("Posting…", "جارٍ التسجيل…") : tr("Post Client Payment", "تسجيل دفعة العميل")}</button>
      </form>
    </CrudModal>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr("Issued Statements", "كشوف الحساب الصادرة")}</h2><span>{tr("Each row is a preserved historical snapshot.", "كل صف يمثل لقطة تاريخية محفوظة.")}</span></div><span>{statements.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Statement", "الكشف")}</th><th>{tr("Client", "العميل")}</th><th>{tr("Scope", "النطاق")}</th><th>{tr("Period", "الفترة")}</th><th>{tr("Opening", "الافتتاحي")}</th><th>{tr("Charges", "الرسوم")}</th><th>{tr("Credits", "الدائن")}</th><th>{tr("Payments", "المدفوعات")}</th><th>{tr("Refunds", "الاستردادات")}</th><th>{tr("Closing", "الختامي")}</th><th>{tr("Status", "الحالة")}</th></tr></thead>
        <tbody>{statements.length === 0 ? <tr><td colSpan={11} className="empty-state">{tr("No statements issued yet.", "لا توجد كشوف حساب صادرة بعد.")}</td></tr> : statements.map(statement => <tr key={statement.id}>
          <td><a href={"/billing/accounts/statements/" + statement.id}><strong>{statement.statementNumber}</strong></a><small className="table-subtext">{statement.generatedAt.slice(0,16).replace("T"," ")}</small></td>
          <td>{statement.clientCode} — {statement.clientName}</td><td>{statement.branchLabel}</td><td>{statement.periodStart} → {statement.periodEnd}</td>
          <td>{statement.openingBalance} {statement.currency}</td><td>{statement.invoiceCharges} {statement.currency}</td><td>{statement.creditNotes} {statement.currency}</td><td>{statement.payments} {statement.currency}</td><td>{statement.refunds} {statement.currency}</td><td><strong>{statement.closingBalance} {statement.currency}</strong></td>
          <td><span className={"status-badge status-" + statement.status.toLowerCase()}>{statusLabel(locale, statement.status)}</span></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
