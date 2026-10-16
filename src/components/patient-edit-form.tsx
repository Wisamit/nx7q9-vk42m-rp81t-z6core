"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
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
  address?: string | null;
  recordedAgeValue?: number | null;
  recordedAgeUnit?: string | null;
  notes: string | null;
  clinicalInformation: string | null;
};

type PatientPayload = Record<string, FormDataEntryValue | null>;

export function PatientEditForm({ patient, locale }: { patient: PatientEditValue; locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState(false);
  const [recordedAgeUnit, setRecordedAgeUnit] = useState<string>(patient.recordedAgeUnit || "YEAR");
  const [message, setMessage] = useState("");
  const [duplicateReview, setDuplicateReview] = useState<{ payload: PatientPayload; candidates: DuplicateCandidate[] } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const updating = useRef(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

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
      address: form.get("address"),
      recordedAgeValue: form.get("recordedAgeValue"),
      recordedAgeUnit: form.get("recordedAgeUnit"),
      notes: form.get("notes"),
      clinicalInformation: form.get("clinicalInformation"),
      changeReason: form.get("changeReason"),
      expectedUpdatedAt: patient.updatedAt,
    };
  }

  async function updatePatient(payload: PatientPayload, overrideReason = "") {
    if (updating.current) return;
    updating.current = true;
    setBusy(true);
    try {
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
      setConfirmDuplicate(false);
      router.refresh();
    } else if (body.error === "possible_duplicates" && body.candidates?.length) {
      setConfirmDuplicate(false);
      setDuplicateReview({ payload, candidates: body.candidates });
      setMessage(tr(
        "These changes would make the patient resemble another active identity. Review before saving.",
        "ستجعل هذه التغييرات المريض مشابهاً لهوية نشطة أخرى. راجع السجلات قبل الحفظ.",
      ));
    } else {
      setConfirmDuplicate(false);
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
    } catch {
      setConfirmDuplicate(false);
      setMessage(tr(
        "Connection interrupted. Verify the patient master and audit before retrying.",
        "انقطع الاتصال. تحقق من سجل المريض وسجل التدقيق قبل إعادة المحاولة.",
      ));
    } finally {
      updating.current = false;
      setBusy(false);
    }
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
    if (updating.current) return;
    setConfirmDuplicate(true);
  }

  async function confirmReviewedDuplicate() {
    if (updating.current || !duplicateReview) return;
    const reason = duplicateReason.trim();
    if (!reason) {
      setConfirmDuplicate(false);
      setMessage(tr("Explain why these are separate identities.", "اشرح لماذا الهويتان منفصلتان."));
      return;
    }
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
      <label>{tr("Full name (Arabic)", "الاسم الكامل بالعربية")}<input name="fullNameAr" maxLength={220} dir="rtl" defaultValue={patient.fullNameAr || ""} /></label>
      <label>{tr("Date of birth (optional)", "تاريخ الميلاد (اختياري)")}<SystemDateField name="dateOfBirth" defaultValue={patient.dateOfBirth || ""} /></label>
      <label>{tr("Age", "العمر")}<input name="recordedAgeValue" type="number" min="0" max={recordedAgeUnit === "DAY" ? 54787 : recordedAgeUnit === "MONTH" ? 1800 : 150} step="1" defaultValue={patient.recordedAgeValue ?? ""} required /></label>
      <label>{tr("Age unit", "وحدة العمر")}<select name="recordedAgeUnit" value={recordedAgeUnit} onChange={event => setRecordedAgeUnit(event.target.value)} required><option value="YEAR">{tr("Years", "سنوات")}</option><option value="MONTH">{tr("Months", "أشهر")}</option><option value="DAY">{tr("Days", "أيام")}</option></select></label>
      <label>{tr("Sex", "الجنس")}<select name="sexAtBirth" defaultValue={patient.sexAtBirth} required>{patient.sexAtBirth === "UNKNOWN" && <option value="UNKNOWN" disabled>{tr("Select sex", "اختر الجنس")}</option>}<option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
      <label>{tr("Phone", "الهاتف")}<input name="phone" maxLength={50} defaultValue={patient.phone || ""} /></label>
      <label>{tr("WhatsApp", "واتساب")}<input name="whatsapp" maxLength={50} defaultValue={patient.whatsapp || ""} /></label>
      <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" maxLength={191} defaultValue={patient.email || ""} /></label>
      <label>{tr("Nationality code", "رمز الجنسية")}<input name="nationalityCode" maxLength={2} defaultValue={patient.nationalityCode || ""} placeholder={tr("ISO code", "رمز ISO")} /></label>
      <label className="form-span">{tr("Address", "العنوان")}<textarea name="address" maxLength={4000} rows={2} dir="auto" defaultValue={patient.address ?? patient.addressAr ?? patient.addressEn ?? ""} /></label>
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

    <CrudModal open={confirmDuplicate} onClose={() => { if (!updating.current) setConfirmDuplicate(false); }}
      size="compact"
      title={tr("Confirm Duplicate Identity Review", "تأكيد مراجعة الهوية المكررة")}
      description={tr(
        "Confirm that you reviewed the possible matches. The recorded reason and audit evidence remain attached to this patient change.",
        "أكّد أنك راجعت الهوية المحتمل تكرارها. سيظل سبب القرار ودليل التدقيق مرتبطين بتعديل بيانات المريض.",
      )}>
      <p className="form-warning">{tr(
        "This is an audited override of a duplicate warning, not a patient merge. Existing released reports retain their original identity snapshots.",
        "هذا تجاوز موثق لتحذير التكرار، وليس دمجاً للمرضى. تظل هوية التقارير الصادرة السابقة محفوظة كما كانت.",
      )}</p>
      <p>{tr("Possible matching records", "السجلات المحتمل تطابقها")}: {duplicateReview?.candidates.length || 0}</p>
      <p><strong>{tr("Reason", "السبب")}:</strong> {duplicateReason.trim()}</p>
      <button type="button" className="primary-button" disabled={busy || !duplicateReason.trim()}
        onClick={() => void confirmReviewedDuplicate()}>
        {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm Reviewed Distinction", "تأكيد مراجعة اختلاف الهوية")}
      </button>
    </CrudModal>
    {message && <p className={duplicateReview ? "form-warning" : "muted"} role="status">{message}</p>}
  </section>;
}
