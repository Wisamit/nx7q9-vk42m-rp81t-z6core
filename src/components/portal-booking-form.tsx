"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalBookingForm({
  branches,
  patients,
  locale,
}: {
  branches: Array<{ id: string; name: string }>;
  patients: Array<{ id: string; label: string }>;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
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
    setMessage(response.ok ? tr("Booking request submitted for confirmation.", "تم إرسال طلب الحجز للتأكيد.") : body.error || tr("Could not submit booking.", "تعذر إرسال طلب الحجز."));
    if (response.ok) {
      event.currentTarget.reset();
      setMode("ONSITE");
      router.refresh();
    }
  }

  return <article className="detail-card detail-section">
    <h2>{tr("Book an Appointment", "حجز موعد")}</h2>
    <p className="muted">{tr("Portal bookings are submitted as requests and must be confirmed by the laboratory.", "تُرسل حجوزات البوابة كطلبات ويجب أن يؤكدها المختبر.")}</p>
    <form className="catalog-form" onSubmit={submit}>
      {patients.length > 1 && <label>{tr("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {patients.length === 1 && <input type="hidden" name="patientId" value={patients[0].id} />}
      <label>{tr("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{tr("Mode", "النوع")}<select value={mode} onChange={e => setMode(e.target.value)}><option value="ONSITE">{tr("Onsite", "في المختبر")}</option><option value="HOME_COLLECTION">{tr("Home collection", "سحب منزلي")}</option></select></label>
      <label>{tr("Service code", "رمز الخدمة")}<input name="serviceCode" /></label>
      <label className="form-span">{tr("Service / request", "الخدمة / الطلب")}<input name="serviceNameSnapshot" required placeholder={tr("Laboratory appointment", "موعد مختبر")} /></label>
      <label>{tr("Preferred date/time", "التاريخ والوقت المفضل")}<input name="scheduledStart" type="datetime-local" required /></label>
      {mode === "HOME_COLLECTION" && <label className="form-span">{tr("Collection address", "عنوان السحب")}<textarea name="address" rows={2} required /></label>}
      <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy}>{busy ? tr("Submitting…", "جارٍ الإرسال…") : tr("Request Booking", "طلب الحجز")}</button>
      {message && <p className="form-success form-span">{message}</p>}
    </form>
  </article>;
}
