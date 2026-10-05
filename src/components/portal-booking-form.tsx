"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalBookingForm({
  branches,
  patients,
}: {
  branches: Array<{ id: string; name: string }>;
  patients: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState("ONSITE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const rawStart = String(form.get("scheduledStart") || "");
    const response = await fetch("/api/portal/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: form.get("branchId"),
        patientId: form.get("patientId"),
        mode,
        serviceCode: form.get("serviceCode"),
        serviceNameSnapshot: form.get("serviceNameSnapshot"),
        scheduledStart: rawStart ? new Date(rawStart).toISOString() : "",
        address: form.get("address"),
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(response.ok ? "Booking request submitted for confirmation." : body.error || "Could not submit booking.");
    if (response.ok) {
      event.currentTarget.reset();
      setMode("ONSITE");
      router.refresh();
    }
  }

  return <article className="detail-card detail-section">
    <h2>Book an Appointment</h2>
    <p className="muted">Portal bookings are submitted as requests and must be confirmed by the laboratory.</p>
    <form className="catalog-form" onSubmit={submit}>
      {patients.length > 1 && <label>Patient<select name="patientId" required defaultValue=""><option value="">Select…</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {patients.length === 1 && <input type="hidden" name="patientId" value={patients[0].id} />}
      <label>Branch<select name="branchId" required defaultValue=""><option value="">Select…</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Mode<select value={mode} onChange={e => setMode(e.target.value)}><option value="ONSITE">Onsite</option><option value="HOME_COLLECTION">Home collection</option></select></label>
      <label>Service code<input name="serviceCode" /></label>
      <label className="form-span">Service / request<input name="serviceNameSnapshot" required placeholder="Laboratory appointment" /></label>
      <label>Preferred date/time<input name="scheduledStart" type="datetime-local" required /></label>
      {mode === "HOME_COLLECTION" && <label className="form-span">Collection address<textarea name="address" rows={2} required /></label>}
      <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy}>{busy ? "Submitting…" : "Request Booking"}</button>
      {message && <p className="form-success form-span">{message}</p>}
    </form>
  </article>;
}
