"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type DuplicateCandidate = {
  id: string;
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  evidence: Array<"NAME_DOB" | "PHONE">;
};

type PatientEditValue = {
  id: string;
  updatedAt: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: string | null;
  sexAtBirth: "MALE" | "FEMALE" | "UNKNOWN";
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  nationalityCode: string | null;
  addressEn: string | null;
  addressAr: string | null;
  notes: string | null;
  clinicalInformation: string | null;
};

type PatientPayload = Record<string, FormDataEntryValue | null>;

export function PatientEditForm({ patient, locale }: { patient: PatientEditValue; locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateReview, setDuplicateReview] = useState<{ payload: PatientPayload; candidates: DuplicateCandidate[] } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");

  function payloadFrom(form: FormData): PatientPayload {
    return {
      fullNameEn: form.get("fullNameEn"),
      fullNameAr: form.get("fullNameAr"),
      dateOfBirth: form.get("dateOfBirth"),
      sexAtBirth: form.get("sexAtBirth"),
      phone: form.get("phone"),
      whatsapp: form.get("whatsapp"),
      email: form.get("email"),
      nationalityCode: form.get("nationalityCode"),
      addressEn: form.get("addressEn"),
      addressAr: form.get("addressAr"),
      notes: form.get("notes"),
      clinicalInformation: form.get("clinicalInformation"),
      changeReason: form.get("changeReason"),
      expectedUpdatedAt: patient.updatedAt,
    };
  }

  async function updatePatient(payload: PatientPayload, overrideReason = "") {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/patients/" + patient.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        duplicateReviewOverride: Boolean(overrideReason),
        duplicateReviewReason: overrideReason || undefined,
      }),
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      candidates?: DuplicateCandidate[];
    };

    if (response.ok) {
      setMessage(tr("Patient details updated.", "تم تحديث بيانات المريض."));
      setDuplicateReview(null);
      setDuplicateReason("");
      router.refresh();
    } else if (body.error === "possible_duplicates" && body.candidates?.length) {
      setDuplicateReview({ payload, candidates: body.candidates });
      setMessage(tr(
        "These changes would make the patient resemble another active identity. Review before saving.",
        "ستجعل هذه التغييرات المريض مشابهاً لهوية نشطة أخرى. راجع السجلات قبل الحفظ.",
      ));
    } else {
      const errors: Record<string, string> = {
        patient_state_changed: tr("The patient changed in another session. Refresh before editing again.", "تغير سجل المريض في جلسة أخرى. حدّث الصفحة قبل التعديل من جديد."),
        patient_not_editable: tr("Merged or inactive patient records cannot be edited.", "لا يمكن تعديل سجلات المرضى المدمجة أو غير النشطة."),
        change_reason_required: tr("A change reason is required.", "سبب التعديل مطلوب."),
        duplicate_review_reason_required: tr("Explain why the matching identity is a different patient.", "اشرح لماذا الهوية المطابقة تخص مريضاً مختلفاً."),
        no_changes: tr("No patient details changed.", "لم تتغير أي بيانات للمريض."),
        future_date_of_birth: tr("Date of birth cannot be in the future.", "لا يمكن أن يكون تاريخ الميلاد في المستقبل."),
      };
      setMessage(errors[body.error || ""] || body.error || tr("Patient update failed.", "تعذر تحديث بيانات المريض."));
    }
    setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDuplicateReview(null);
    setDuplicateReason("");
    await updatePatient(payloadFrom(new FormData(event.currentTarget)));
  }

  async function saveAfterDuplicateReview() {
    if (!duplicateReview) return;
    const reason = duplicateReason.trim();
    if (!reason) {
      setMessage(tr("Explain why this is a different patient.", "اشرح لماذا هذا مريض مختلف."));
      return;
    }
    if (!window.confirm(tr(
      "Save these changes after duplicate review? The decision and reason will be audited.",
      "حفظ التغييرات بعد مراجعة التكرار؟ سيتم تسجيل القرار والسبب في سجل التدقيق.",
    ))) return;
    await updatePatient(duplicateReview.payload, reason);
  }

  const evidenceLabel = (code: DuplicateCandidate["evidence"][number]) =>
    code === "NAME_DOB"
      ? tr("Same normalized name + date of birth", "نفس الاسم المطبع + تاريخ الميلاد")
      : tr("Same phone", "نفس رقم الهاتف");

  return <section className="detail-card">
    <h2>{tr("Edit Patient Master", "تعديل بيانات المريض")}</h2>
    <p className="muted">{tr(
      "Changes affect the current patient master only. Already issued diagnostic reports keep their immutable patient snapshots.",
      "تؤثر التغييرات على سجل المريض الحالي فقط. التقارير التشخيصية الصادرة مسبقاً تحتفظ بلقطة بيانات المريض التاريخية.",
    )}</p>
    <form className="catalog-form" onSubmit={submit}>
      <label>{tr("Full name (English)", "الاسم الكامل بالإنجليزية")}<input name="fullNameEn" required maxLength={220} defaultValue={patient.fullNameEn} /></label>
      <label dir="rtl">الاسم الكامل بالعربية<input name="fullNameAr" maxLength={220} dir="rtl" defaultValue={patient.fullNameAr || ""} /></label>
      <label>{tr("Date of birth", "تاريخ الميلاد")}<input name="dateOfBirth" type="date" defaultValue={patient.dateOfBirth || ""} /></label>
      <label>{tr("Sex at birth", "الجنس عند الولادة")}<select name="sexAtBirth" defaultValue={patient.sexAtBirth}><option value="UNKNOWN">{tr("Unknown", "غير محدد")}</option><option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
      <label>{tr("Phone", "الهاتف")}<input name="phone" maxLength={50} defaultValue={patient.phone || ""} /></label>
      <label>{tr("WhatsApp", "واتساب")}<input name="whatsapp" maxLength={50} defaultValue={patient.whatsapp || ""} /></label>
      <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" maxLength={191} defaultValue={patient.email || ""} /></label>
      <label>{tr("Nationality code", "رمز الجنسية")}<input name="nationalityCode" maxLength={2} defaultValue={patient.nationalityCode || ""} placeholder={tr("ISO code", "رمز ISO")} /></label>
      <label>{tr("Address (English)", "العنوان بالإنجليزية")}<textarea name="addressEn" maxLength={4000} rows={2} defaultValue={patient.addressEn || ""} /></label>
      <label dir="rtl">{tr("Address (Arabic)", "العنوان بالعربية")}<textarea name="addressAr" maxLength={4000} rows={2} dir="rtl" defaultValue={patient.addressAr || ""} /></label>
      <label>{tr("Clinical information", "المعلومات السريرية")}<textarea name="clinicalInformation" maxLength={4000} rows={3} defaultValue={patient.clinicalInformation || ""} /></label>
      <label>{tr("Notes", "ملاحظات")}<textarea name="notes" maxLength={4000} rows={3} defaultValue={patient.notes || ""} /></label>
      <label className="form-span">{tr("Change reason", "سبب التعديل")}<textarea name="changeReason" required maxLength={1000} rows={2} /></label>
      <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Patient Changes", "حفظ تعديلات المريض")}</button>
    </form>

    {duplicateReview && <div className="detail-section">
      <h3>{tr("Duplicate Review Required", "مراجعة التكرار مطلوبة")}</h3>
      <div className="summary-list">{duplicateReview.candidates.map(candidate => <div key={candidate.id}>
        <span>
          <strong>{candidate.patientNumber} · {locale === "ar" ? candidate.fullNameAr || candidate.fullNameEn : candidate.fullNameEn}</strong>
          <small className="table-subtext">{candidate.dateOfBirth?.slice(0,10) || "—"} · {candidate.phone || "—"}</small>
        </span>
        <strong>{candidate.evidence.map(evidenceLabel).join(" · ")}</strong>
      </div>)}</div>
      <label>{tr("Reason identities are different", "سبب اعتبار الهويتين مختلفتين")}<textarea value={duplicateReason} onChange={event => setDuplicateReason(event.target.value)} maxLength={1000} rows={3} /></label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void saveAfterDuplicateReview()}>
        {tr("Reviewed — Save Changes", "تمت المراجعة — حفظ التغييرات")}
      </button>
    </div>}

    {message && <p className={duplicateReview ? "form-warning" : "muted"}>{message}</p>}
  </section>;
}
