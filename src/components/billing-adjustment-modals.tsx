"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type CreditInvoiceOption = {
  id: string;
  invoiceNumber: string;
  currency: string;
  remainingCredit: string;
  balanceAmount: string;
};

type RefundOption = {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  remainingRefundable: string;
  receivedAt: string;
  method: string;
};

function errorMessage(locale: "ar" | "en", code: string) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const messages: Record<string, string> = {
    invalid_fields: tr("Complete all required fields.", "أكمل جميع الحقول المطلوبة."),
    invalid_amount: tr("Enter a valid amount.", "أدخل مبلغًا صحيحًا."),
    invoice_not_creditable: tr("This invoice cannot receive a credit note.", "لا يمكن إصدار إشعار دائن لهذه الفاتورة."),
    invoice_fully_credited: tr("The invoice is already fully credited.", "تمت تسوية كامل قيمة الفاتورة بإشعارات دائنة."),
    credit_exceeds_remaining_amount: tr("Credit amount exceeds the remaining creditable amount.", "مبلغ الإشعار الدائن يتجاوز المبلغ المتاح للتسوية."),
    payment_not_refundable: tr("This payment is not refundable.", "لا يمكن استرداد هذه الدفعة."),
    payment_allocation_fully_refunded: tr("This payment allocation is already fully refunded.", "تم استرداد كامل المبلغ المخصص لهذه الفاتورة."),
    refund_exceeds_allocation: tr("Refund amount exceeds the remaining refundable allocation.", "مبلغ الاسترداد يتجاوز المبلغ المتبقي القابل للاسترداد."),
    refund_exceeds_payment: tr("Refund amount exceeds the remaining payment amount.", "مبلغ الاسترداد يتجاوز الرصيد المتبقي من الدفعة."),
    refund_exceeds_invoice_net_payment: tr("Refund amount exceeds the invoice net paid amount.", "مبلغ الاسترداد يتجاوز صافي المدفوع على الفاتورة."),
    invoice_changed: tr("The invoice changed while processing. Review the latest balance and try again.", "تغيرت الفاتورة أثناء المعالجة. راجع الرصيد الحالي ثم أعد المحاولة."),
    payment_changed: tr("The payment changed while processing. Review it and try again.", "تغيرت الدفعة أثناء المعالجة. راجعها ثم أعد المحاولة."),
  };
  return messages[code] || tr("The financial adjustment could not be posted.", "تعذر تسجيل التسوية المالية.");
}

export function CreditNoteCreateModal({
  invoices,
  locale,
}: {
  invoices: CreditInvoiceOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/billing/credit-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: form.get("invoiceId"),
        amount: form.get("amount"),
        reason: form.get("reason"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const success = `${tr("Credit note issued", "تم إصدار الإشعار الدائن")} · ${body.creditNoteNumber} · ${tr("Balance", "الرصيد")}: ${body.balanceAmount}`;
      setNotice(success);
      setOpen(false);
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(errorMessage(locale, body.error || ""));
    }
    setBusy(false);
  }

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="secondary-button" disabled={invoices.length === 0} onClick={() => { setMessage(""); setOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Issue Credit Note", "إصدار إشعار دائن")}
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("Issue Credit Note", "إصدار إشعار دائن")}
      description={tr("Create a traceable financial adjustment without changing the original invoice amount.", "أنشئ تسوية مالية قابلة للتتبع دون تغيير القيمة الأصلية للفاتورة.")}
      size="md"
    >
      <form className="catalog-form" onSubmit={submit}>
        <label className="form-span">{tr("Invoice", "الفاتورة")}
          <select name="invoiceId" required defaultValue="">
            <option value="">{tr("Select invoice…", "اختر الفاتورة…")}</option>
            {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.remainingCredit} {invoice.currency} · {tr("balance", "الرصيد")} {invoice.balanceAmount}</option>)}
          </select>
        </label>
        <label>{tr("Credit amount", "مبلغ الإشعار")}<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
        <label className="form-span">{tr("Reason", "السبب")}<textarea name="reason" maxLength={1000} required /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Issuing…", "جارٍ الإصدار…") : tr("Issue Credit Note", "إصدار الإشعار الدائن")}</button>
        {message && <div className="form-error form-span">{message}</div>}
      </form>
    </CrudModal>
  </>;
}

export function RefundCreateModal({
  options,
  locale,
}: {
  options: RefundOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const allocation = String(form.get("allocation") || "");
    const [paymentId, invoiceId] = allocation.split("|");
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/billing/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId,
        invoiceId,
        amount: form.get("amount"),
        reason: form.get("reason"),
        reference: form.get("reference"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const success = `${tr("Refund posted", "تم تسجيل الاسترداد")} · ${body.refundNumber} · ${tr("Invoice balance", "رصيد الفاتورة")}: ${body.balanceAmount}`;
      setNotice(success);
      setOpen(false);
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(errorMessage(locale, body.error || ""));
    }
    setBusy(false);
  }

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="secondary-button" disabled={options.length === 0} onClick={() => { setMessage(""); setOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Post Refund", "تسجيل استرداد")}
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("Post Refund", "تسجيل استرداد")}
      description={tr("Return money against an existing payment while keeping the original payment and allocation intact.", "أعد مبلغًا مقابل دفعة موجودة مع الإبقاء على الدفعة والتخصيص الأصليين دون تعديل.")}
      size="md"
    >
      <form className="catalog-form" onSubmit={submit}>
        <label className="form-span">{tr("Payment allocation", "تخصيص الدفعة")}
          <select name="allocation" required defaultValue="">
            <option value="">{tr("Select refundable payment…", "اختر دفعة قابلة للاسترداد…")}</option>
            {options.map(option => <option key={option.paymentId + option.invoiceId} value={option.paymentId + "|" + option.invoiceId}>{option.invoiceNumber} — {option.remainingRefundable} {option.currency} · {option.method} · {option.receivedAt.slice(0, 10)}</option>)}
          </select>
        </label>
        <label>{tr("Refund amount", "مبلغ الاسترداد")}<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
        <label className="form-span">{tr("Reason", "السبب")}<textarea name="reason" maxLength={1000} required /></label>
        <label className="form-span">{tr("Reference", "المرجع")}<input name="reference" maxLength={150} placeholder={tr("Refund / bank / card reference", "مرجع الاسترداد / البنك / البطاقة")} /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Posting…", "جارٍ التسجيل…") : tr("Post Refund", "تسجيل الاسترداد")}</button>
        {message && <div className="form-error form-span">{message}</div>}
      </form>
    </CrudModal>
  </>;
}
