"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PatientCreateForm({ locale, onSuccess }: { locale: "ar" | "en"; onSuccess?: (message: string) => void }) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullNameEn: form.get("fullNameEn"),
        fullNameAr: form.get("fullNameAr"),
        dateOfBirth: form.get("dateOfBirth"),
        sexAtBirth: form.get("sexAtBirth"),
        phone: form.get("phone"),
        email: form.get("email"),
        nationalId: form.get("nationalId"),
        nationalityCode: form.get("nationalityCode"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const success = `${tr("Patient created", "تم إنشاء المريض")}: ${body.patient.patientNumber}`;
      setMessage(success);
      event.currentTarget.reset();
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "possible_duplicate" || body.error === "identifier_already_used") {
      setMessage(`${tr("Potential duplicate found", "تم العثور على مريض مشابه محتمل")}: ${body.patient?.patientNumber || ""} ${body.patient?.fullNameEn || ""}`);
    } else {
      setMessage(body.error || tr("Patient creation failed.", "تعذر إنشاء المريض."));
    }
    setBusy(false);
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label>{tr("Full name (English)", "الاسم الكامل بالإنجليزية")}<input name="fullNameEn" required maxLength={220} /></label>
    <label dir="rtl">الاسم الكامل بالعربية<input name="fullNameAr" maxLength={220} dir="rtl" /></label>
    <label>{tr("Date of birth", "تاريخ الميلاد")}<input name="dateOfBirth" type="date" /></label>
    <label>{tr("Sex at birth", "الجنس عند الولادة")}<select name="sexAtBirth" defaultValue="UNKNOWN"><option value="UNKNOWN">{tr("Unknown", "غير محدد")}</option><option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
    <label>{tr("Phone", "الهاتف")}<input name="phone" maxLength={50} /></label>
    <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" maxLength={191} /></label>
    <label>{tr("National ID", "الرقم القومي")}<input name="nationalId" maxLength={120} /></label>
    <label>{tr("Nationality code", "رمز الجنسية")}<input name="nationalityCode" maxLength={2} placeholder="EG" /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Patient", "إنشاء المريض")}</button>
    {message && <div className="form-success form-span">{message}</div>}
  </form>;
}
