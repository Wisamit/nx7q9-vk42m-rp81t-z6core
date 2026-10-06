"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type InvoiceOption = {
  id: string;
  invoiceNumber: string;
  currency: string;
  balanceAmount: string;
};

export function PaymentForm({ invoices, locale, onSuccess }: { invoices: InvoiceOption[]; locale: "ar" | "en"; onSuccess?: (message: string) => void }) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/billing/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: form.get("invoiceId"),
        amount: form.get("amount"),
        method: form.get("method"),
        reference: form.get("reference"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const success = `${tr("Payment posted", "تم تسجيل الدفعة")}. ${tr("Invoice", "الفاتورة")} ${body.invoiceNumber} · ${tr("Balance", "الرصيد")}: ${body.balanceAmount}`;
      setMessage(success);
      event.currentTarget.reset();
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "amount_exceeds_balance") {
      setMessage(`${tr("Amount exceeds invoice balance", "المبلغ يتجاوز رصيد الفاتورة")} (${body.balance}).`);
    } else {
      setMessage(body.error || tr("Payment could not be posted.", "تعذر تسجيل الدفعة."));
    }
    setBusy(false);
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">Invoice
      <select name="invoiceId" required defaultValue="">
        <option value="">{tr("Select open invoice…", "اختر فاتورة مفتوحة…")}</option>
        {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.balanceAmount} {invoice.currency}</option>)}
      </select>
    </label>
    <label>{tr("Amount", "المبلغ")}<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
    <label>{tr("Method", "طريقة الدفع")}<select name="method" defaultValue="CASH"><option value="CASH">{tr("Cash", "نقدي")}</option><option value="CARD">{tr("Card", "بطاقة")}</option><option value="BANK_TRANSFER">{tr("Bank transfer", "تحويل بنكي")}</option><option value="ONLINE">{tr("Online", "إلكتروني")}</option><option value="OTHER">{tr("Other", "أخرى")}</option></select></label>
    <label className="form-span">{tr("Reference", "المرجع")}<input name="reference" maxLength={150} placeholder={tr("Receipt / transaction / bank reference", "رقم الإيصال / العملية / مرجع البنك")} /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Posting…", "جارٍ التسجيل…") : tr("Post Payment", "تسجيل الدفعة")}</button>
    {message && <div className="form-success form-span">{message}</div>}
  </form>;
}
