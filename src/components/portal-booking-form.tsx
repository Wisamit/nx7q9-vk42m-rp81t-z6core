"use client";
import { SystemDateTimeField } from "@/components/system-date-time-field";

import { FormEvent, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { useRouter } from "next/navigation";
import { parseSystemLocalDateTime } from "@/lib/system-date-time";
import { requestPortalBooking } from "@/lib/portal-booking-client";

export function PortalBookingForm({
  branches,
  patients,
  locale,
}: {
  branches: Array<{ id: string; name: string; timeZone: string }>;
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
  const uncertain = useRef(false);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || uncertain.current || requiresReconciliation) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawStart = String(form.get("scheduledStart") || "");
    const localTime = parseSystemLocalDateTime(rawStart);
    if (!localTime.date || !localTime.time) {
      setError(true);
      setMessage(tr("Enter a valid preferred date and time.", "أدخل تاريخاً ووقتاً مفضلين صالحين."));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      // The backend resolves branch wall time using the selected branch's
      // configured timezone, not the browser's current location or timezone.
      const outcome = await requestPortalBooking({
        branchId: String(form.get("branchId") || ""),
        patientId: String(form.get("patientId") || ""),
        mode,
        serviceCode: String(form.get("serviceCode") || ""),
        serviceNameSnapshot: String(form.get("serviceNameSnapshot") || ""),
        scheduledStartLocal: rawStart,
        address: String(form.get("address") || ""),
        notes: String(form.get("notes") || ""),
      });
      if (outcome.kind === "requested") {
        formElement.reset();
        setMode("ONSITE");
        setMessage(tr("Booking request submitted for confirmation.", "تم إرسال طلب الحجز للتأكيد."));
        setOpen(false);
        router.refresh();
        return;
      }
      setError(true);
      if (outcome.kind === "rejected") {
        const errors: Record<string,string> = {
          invalid_branch_local_schedule: tr(
            "This time is invalid, has passed, or is ambiguous in the selected branch's timezone. Choose another time.",
            "الوقت غير صالح أو مضى أو ملتبس حسب توقيت الفرع المحدد. اختر وقتاً آخر.",
          ),
          invalid_booking_request: tr("Check the booking fields and try again.", "تحقق من بيانات الحجز ثم حاول مجدداً."),
          home_collection_address_required: tr("Enter the home collection address.", "أدخل عنوان السحب المنزلي."),
          corporate_patient_not_authorized_for_booking: tr("You are not authorized to book for this patient.", "ليس لديك تفويض لحجز موعد لهذا المريض."),
          portal_unauthorized: tr("Your portal session expired. Sign in again.", "انتهت جلسة البوابة. سجّل الدخول من جديد."),
          branch_or_patient_not_found: tr("The selected branch or patient is no longer available.", "الفرع أو المريض المحدد لم يعد متاحاً."),
        };
        setMessage(errors[outcome.error] || tr("Could not submit booking.", "تعذر إرسال طلب الحجز."));
        return;
      }
      // A disconnected HTTP response may follow a committed booking and
      // creating another request could duplicate the appointment.
      uncertain.current = true;
      setRequiresReconciliation(true);
      setMessage(tr(
        "Booking status is unknown. Check your appointments after reloading this page before submitting another request.",
        "حالة الحجز غير مؤكدة. تحقّق من مواعيدك بعد إعادة تحميل الصفحة قبل إرسال طلب جديد.",
      ));
    } catch {
      uncertain.current = true;
      setRequiresReconciliation(true);
      setError(true);
      setMessage(tr(
        "Booking status is unknown. Reload and check your appointments before retrying.",
        "حالة الحجز غير مؤكدة. أعد تحميل الصفحة وتحقّق من مواعيدك قبل إعادة المحاولة.",
      ));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <article className="detail-card detail-section">
    <h2>{tr("Book an Appointment", "حجز موعد")}</h2>
    <p className="muted">{tr("Portal bookings are submitted as requests and must be confirmed by the laboratory.", "تُرسل حجوزات البوابة كطلبات ويجب أن يؤكدها المختبر.")}</p>
    <button type="button" className="primary-button" disabled={busy || requiresReconciliation} onClick={() => { setMessage(""); setError(false); setOpen(true); }}>
      {tr("Request Booking", "طلب حجز")}
    </button>
    {message && !open && <p className={error ? "form-error" : "form-success"} role={error ? "alert" : "status"}>{message}</p>}
    <CrudModal open={open} onClose={() => { if (!submitting.current) setOpen(false); }} size="compact"
      title={tr("Book an Appointment", "حجز موعد")}
      description={tr("The laboratory must confirm your request. No order or result is created here.", "يجب على المختبر تأكيد طلبك. لا يتم إنشاء طلب تحليل أو نتيجة من هنا.")}>
      <form className="catalog-form" onSubmit={submit}>
      {patients.length > 1 && <label>{tr("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {patients.length === 1 && <input type="hidden" name="patientId" value={patients[0].id} />}
      <label>{tr("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.name} ({item.timeZone})</option>)}</select></label>
      <label>{tr("Mode", "النوع")}<select value={mode} onChange={e => setMode(e.target.value)}><option value="ONSITE">{tr("Onsite", "في المختبر")}</option><option value="HOME_COLLECTION">{tr("Home collection", "سحب منزلي")}</option></select></label>
      <label>{tr("Service code", "رمز الخدمة")}<input name="serviceCode" /></label>
      <label className="form-span">{tr("Service / request", "الخدمة / الطلب")}<input name="serviceNameSnapshot" required placeholder={tr("Laboratory appointment", "موعد مختبر")} /></label>
      <label>{tr("Preferred branch-local date/time", "التاريخ والوقت بتوقيت الفرع")}<SystemDateTimeField name="scheduledStart" required /></label>
      {mode === "HOME_COLLECTION" && <label className="form-span">{tr("Collection address", "عنوان السحب")}<textarea name="address" rows={2} required /></label>}
      <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy || requiresReconciliation}>{busy ? tr("Submitting…", "جارٍ الإرسال…") : tr("Request Booking", "طلب الحجز")}</button>
      {message && <p className={(error ? "form-error" : "form-success") + " form-span"} role={error ? "alert" : "status"}>{message}</p>}
      </form>
    </CrudModal>
  </article>;
}
