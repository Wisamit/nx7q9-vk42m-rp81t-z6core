"use client";

import { FormEvent, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
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
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawStart = String(form.get("scheduledStart") || "");
    const date = new Date(rawStart);
    if (!rawStart || !Number.isFinite(date.getTime())) {
      setError(true);
      setMessage(tr("Enter a valid preferred date and time.", "أدخل تاريخاً ووقتاً مفضلين صالحين."));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/portal/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: form.get("branchId"),
          patientId: form.get("patientId"),
          mode,
          serviceCode: form.get("serviceCode"),
          serviceNameSnapshot: form.get("serviceNameSnapshot"),
          scheduledStart: date.toISOString(),
          address: form.get("address"),
          notes: form.get("notes"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(true);
        setMessage(body.error || tr("Could not submit booking.", "تعذر إرسال طلب الحجز."));
        return;
      }
      formElement.reset();
      setMode("ONSITE");
      setMessage(tr("Booking request submitted for confirmation.", "تم إرسال طلب الحجز للتأكيد."));
      setOpen(false);
      router.refresh();
    } catch {
      setError(true);
      setMessage(tr(
        "Connection interrupted. Check your appointments before submitting another request.",
        "انقطع الاتصال. تحقق من مواعيدك قبل إرسال طلب جديد.",
      ));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <article className="detail-card detail-section">
    <h2>{tr("Book an Appointment", "حجز موعد")}</h2>
    <p className="muted">{tr("Portal bookings are submitted as requests and must be confirmed by the laboratory.", "تُرسل حجوزات البوابة كطلبات ويجب أن يؤكدها المختبر.")}</p>
    <button type="button" className="primary-button" disabled={busy} onClick={() => { setMessage(""); setError(false); setOpen(true); }}>
      {tr("Request Booking", "طلب حجز")}
    </button>
    {message && !open && <p className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{message}</p>}
    <CrudModal open={open} onClose={() => { if (!submitting.current) setOpen(false); }} size="compact"
      title={tr("Book an Appointment", "حجز موعد")}
      description={tr("The laboratory must confirm your request. No order or result is created here.", "يجب على المختبر تأكيد طلبك. لا يتم إنشاء طلب تحليل أو نتيجة من هنا.")}>
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
      {message && <p className={(error ? "form-error" : "form-success") + " form-span"} role={error ? "alert" : "status"}>{message}</p>}
      </form>
    </CrudModal>
  </article>;
}
