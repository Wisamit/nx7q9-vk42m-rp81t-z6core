"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type InvoiceOption = {
  id: string;
  invoiceNumber: string;
  currency: string;
  balanceAmount: string;
};

export function PaymentForm({ invoices }: { invoices: InvoiceOption[] }) {
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
      setMessage(`Payment posted. Invoice ${body.invoiceNumber} balance: ${body.balanceAmount}`);
      event.currentTarget.reset();
      router.refresh();
    } else if (body.error === "amount_exceeds_balance") {
      setMessage(`Amount exceeds invoice balance (${body.balance}).`);
    } else {
      setMessage(body.error || "Payment could not be posted.");
    }
    setBusy(false);
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">Invoice
      <select name="invoiceId" required defaultValue="">
        <option value="">Select open invoice…</option>
        {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} — {invoice.balanceAmount} {invoice.currency}</option>)}
      </select>
    </label>
    <label>Amount<input name="amount" type="number" min="0.0001" step="0.0001" required /></label>
    <label>Method<select name="method" defaultValue="CASH"><option>CASH</option><option>CARD</option><option>BANK_TRANSFER</option><option>ONLINE</option><option>CREDIT_ACCOUNT</option><option>OTHER</option></select></label>
    <label className="form-span">Reference<input name="reference" maxLength={150} placeholder="Receipt / transaction / bank reference" /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? "Posting…" : "Post Payment"}</button>
    {message && <div className="form-success form-span">{message}</div>}
  </form>;
}
