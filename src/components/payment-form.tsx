"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type InvoiceOption = {
  id: string;
  invoiceNumber: string;
  currency: string;
  balanceAmount: string;
};

type PaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  baseMethod: string;
  requiresReference: boolean;
};

export function PaymentForm({
  invoices,
  paymentMethods,
  locale,
  onSuccess,
}: {
  invoices: InvoiceOption[];
  paymentMethods: PaymentMethodOption[];
  locale: "ar" | "en";
  onSuccess?: (message: string) => void;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id || "");
  const selectedMethod = paymentMethods.find(method => method.id === paymentMethodId);
  const postingAttempt = useRef<{ payload: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const payload = JSON.stringify({
      invoiceId: form.get("invoiceId"),
      amount: form.get("amount"),
      paymentMethodId,
      reference: form.get("reference"),
    });
    if (!postingAttempt.current || postingAttempt.current.payload !== payload) {
      postingAttempt.current = { payload, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch("/api/billing/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload), postingKey: postingAttempt.current.key }),
      });
      const body = await response.json().catch(() => ({}));

    if (response.ok) {
      postingAttempt.current = null;
      const success = `${tr("Payment posted", "تم تسجيل الدفعة")}. ${tr("Invoice", "الفاتورة")} ${body.invoiceNumber} · ${tr("Balance", "الرصيد")}: ${body.balanceAmount}`;
      setMessage(success);
      event.currentTarget.reset();
      setPaymentMethodId(paymentMethods[0]?.id || "");
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "amount_exceeds_balance") {
      setMessage(`${tr("Amount exceeds invoice balance", "المبلغ يتجاوز رصيد الفاتورة")} (${body.balance}).`);
    } else if (body.error === "cashier_shift_required") {
      setMessage(tr("Open a cashier shift for this branch and currency before posting payments.", "افتح وردية أمين صندوق لهذا الفرع وهذه العملة قبل تسجيل الدفعات."));
    } else if (body.error === "cashier_shift_changed") {
      setMessage(tr("The cashier shift changed while posting. Refresh and try again.", "تغيرت وردية أمين الصندوق أثناء التسجيل. حدّث الصفحة وحاول مجددًا."));
    } else if (body.error === "payment_method_not_available") {
      setMessage(tr("The selected payment method is no longer available.", "طريقة الدفع المحددة لم تعد متاحة."));
    } else if (body.error === "payment_method_reference_required") {
      setMessage(tr("This payment method requires a transaction/reference number.", "طريقة الدفع هذه تتطلب رقم مرجع أو عملية."));
    } else if (body.error === "payment_posting_state_changed") {
      setMessage(tr("This payment was subsequently refunded or voided. Review current invoice and payment history before initiating a new transaction.", "تم استرداد هذه الدفعة أو إلغاؤها لاحقاً. راجع سجل الدفعات والفاتورة قبل إنشاء عملية جديدة."));
    } else if (body.error === "posting_key_reused") {
      setMessage(tr("Payment request was changed. Review the values before submitting a new attempt.", "تم تغيير طلب الدفعة. راجع البيانات قبل إنشاء محاولة جديدة."));
    } else {
      setMessage(body.error || tr("Payment could not be posted.", "تعذر تسجيل الدفعة."));
    }
    } catch {
      setMessage(tr("Connection interrupted. Check the posting status; submitting the unchanged form will safely retry the same request.", "انقطع الاتصال. تحقق من حالة الدفعة؛ إعادة إرسال نفس البيانات تستخدم رقم المحاولة نفسه دون تكرار القيد."));
    } finally {
      setBusy(false);
    }
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">{tr("Invoice","الفاتورة")}
      <select name="invoiceId" required defaultValue="">
        <option value="">{tr("Select open invoice…", "اختر فاتورة مفتوحة…")}</option>
        {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.balanceAmount} {invoice.currency}</option>)}
      </select>
    </label>
    <label>{tr("Amount", "المبلغ")}<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
    <label>{tr("Method", "طريقة الدفع")}<select name="paymentMethodId" required value={paymentMethodId} onChange={event => setPaymentMethodId(event.target.value)}>
      <option value="">{tr("Select method…", "اختر الطريقة…")}</option>
      {paymentMethods.map(method => <option key={method.id} value={method.id}>{method.name} · {method.code}</option>)}
    </select></label>
    <label className="form-span">{tr("Reference", "المرجع")}<input name="reference" maxLength={150} required={selectedMethod?.requiresReference === true} placeholder={selectedMethod?.requiresReference ? tr("Required transaction/reference number", "رقم المرجع أو العملية مطلوب") : tr("Receipt / transaction / bank reference", "رقم الإيصال / العملية / مرجع البنك")} /></label>
    <button className="primary-button form-span" disabled={busy || paymentMethods.length === 0}>{busy ? tr("Posting…", "جارٍ التسجيل…") : tr("Post Payment", "تسجيل الدفعة")}</button>
    {message && <div className="form-success form-span">{message}</div>}
  </form>;
}
