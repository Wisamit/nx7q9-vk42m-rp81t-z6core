"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ClientOption = { id: string; code: string; nameEn: string };

export function ClientReferrerForms({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [clientMessage, setClientMessage] = useState("");
  const [referrerMessage, setReferrerMessage] = useState("");
  const [busy, setBusy] = useState<"client" | "referrer" | "">("");

  async function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("client"); setClientMessage("");
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        type: form.get("type"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        phone: form.get("phone"),
        email: form.get("email"),
        paymentTermsDays: form.get("paymentTermsDays"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setClientMessage(`Client created: ${body.client.code}`);
      event.currentTarget.reset();
      router.refresh();
    } else setClientMessage(body.error || "Client creation failed.");
    setBusy("");
  }

  async function submitReferrer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("referrer"); setReferrerMessage("");
    const response = await fetch("/api/referrers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        type: form.get("type"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        phone: form.get("phone"),
        email: form.get("email"),
        licenseNumber: form.get("licenseNumber"),
        clientId: form.get("clientId"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setReferrerMessage(`Referrer created: ${body.referrer.code}`);
      event.currentTarget.reset();
      router.refresh();
    } else setReferrerMessage(body.error || "Referrer creation failed.");
    setBusy("");
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>Add Client</h2>
      <form className="catalog-form" onSubmit={submitClient}>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        <label>Type<select name="type" defaultValue="CLINIC"><option>INDIVIDUAL</option><option>CLINIC</option><option>HOSPITAL</option><option>COMPANY</option><option>INSURANCE</option><option>OTHER</option></select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>Phone<input name="phone" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="3650" /></label>
        <button className="primary-button form-span" disabled={busy === "client"}>{busy === "client" ? "Saving…" : "Create Client"}</button>
        {clientMessage && <div className="form-success form-span">{clientMessage}</div>}
      </form>
    </article>

    <article className="detail-card">
      <h2>Add Referrer</h2>
      <form className="catalog-form" onSubmit={submitReferrer}>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        <label>Type<select name="type" defaultValue="PHYSICIAN"><option>PHYSICIAN</option><option>CLINIC</option><option>HOSPITAL</option><option>OTHER</option></select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>License #<input name="licenseNumber" /></label>
        <label>Phone<input name="phone" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Billing client<select name="clientId" defaultValue=""><option value="">No linked client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.code} — {client.nameEn}</option>)}</select></label>
        <button className="primary-button form-span" disabled={busy === "referrer"}>{busy === "referrer" ? "Saving…" : "Create Referrer"}</button>
        {referrerMessage && <div className="form-success form-span">{referrerMessage}</div>}
      </form>
    </article>
  </div>;
}
