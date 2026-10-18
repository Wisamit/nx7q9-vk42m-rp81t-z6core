"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation"
import { CrudModal } from "@/components/crud-modal";;

type DuplicateCandidate = {
  id: string;
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  evidence: Array<"NAME_DOB" | "PHONE">;
};

type PatientPayload = Record<string, unknown>;

type IdentifierSchemeOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  requiresIssuingCountry: boolean;
};

type AdditionalIdentifier = {
  schemeId: string;
  value: string;
  issuingCountry: string;
};

export function PatientCreateForm({
  locale,
  identifierSchemes,
  onSuccess,
}: {
  locale: "ar" | "en";
  identifierSchemes: IdentifierSchemeOption[];
  onSuccess?: (message: string) => void;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const creationKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [recordedAgeUnit, setRecordedAgeUnit] = useState<string>("YEAR");
  const [message, setMessage] = useState("");
  const [duplicateReview, setDuplicateReview] = useState<{ payload: PatientPayload; candidates: DuplicateCandidate[] } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [confirmSeparate, setConfirmSeparate] = useState(false);
  const [additionalIdentifiers, setAdditionalIdentifiers] = useState<AdditionalIdentifier[]>([]);

  function payloadFrom(form: FormData): PatientPayload {
    return {
      fullNameEn: form.get("fullNameEn"),
      fullNameAr: form.get("fullNameAr"),
      dateOfBirth: form.get("dateOfBirth"),
      sexAtBirth: form.get("sexAtBirth"),
      phone: form.get("phone"),
      whatsapp: form.get("whatsapp"),
      email: form.get("email"),
      nationalId: form.get("nationalId"),
      nationalityCode: form.get("nationalityCode"),
      address: form.get("address"),
      recordedAgeValue: form.get("recordedAgeValue"),
      recordedAgeUnit: form.get("recordedAgeUnit"),
      notes: form.get("notes"),
      clinicalInformation: form.get("clinicalInformation"),
      customIdentifiers: additionalIdentifiers
        .filter(item => item.schemeId && item.value.trim())
        .map(item => ({
          schemeId: item.schemeId,
          value: item.value.trim(),
          issuingCountry: item.issuingCountry.trim().toUpperCase(),
        })),
    };
  }

  async function createPatient(payload: PatientPayload, overrideReason = "") {
    if (inFlight.current) return;
    inFlight.current = true;
    creationKey.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage("");

    try {
    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json",
        "x-family-lab-patient-key": creationKey.current! },
      body: JSON.stringify({
        ...payload,
        duplicateReviewOverride: Boolean(overrideReason),
        duplicateReviewReason: overrideReason || undefined,
      }),
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      patient?: { patientNumber?: string; fullNameEn?: string };
      candidates?: DuplicateCandidate[];
      replayed?: boolean;
    };

    if (response.ok) {
      const success = `${body.replayed
        ? tr("Previous registration confirmed", "تم تأكيد التسجيل السابق")
        : tr("Patient created", "تم إنشاء المريض")}: ${body.patient?.patientNumber || ""}`;
      creationKey.current = null;
      setMessage(success);
      setDuplicateReview(null);
      setConfirmSeparate(false);
      setDuplicateReason("");
      formRef.current?.reset();
      setAdditionalIdentifiers([]);
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "possible_duplicates" && body.candidates?.length) {
      // A clinically reviewed override is a DIFFERENT intentional request.
      creationKey.current = null;
      setDuplicateReview({ payload, candidates: body.candidates });
      setMessage(tr(
        "Potential duplicate identities require review before creating a separate patient.",
        "توجد هويات مريض محتملة التكرار ويجب مراجعتها قبل إنشاء مريض مستقل.",
      ));
    } else if (body.error === "patient_creation_submission_conflict" ||
        body.error === "patient_creation_record_changed") {
      setMessage(tr(
        "This request key belongs to a different or changed registration. Find the previous patient in the central registry before starting a fresh attempt.",
        "مفتاح الطلب يعود إلى تسجيل مختلف أو تغيّرت هويته. ابحث عن المريض السابق في السجل المركزي قبل بدء طلب جديد.",
      ));
    } else if (body.error === "identifier_already_used") {
      creationKey.current = null;
      setMessage(`${tr("Identifier already belongs to another patient", "المعرّف مستخدم لمريض آخر")}: ${body.patient?.patientNumber || ""} ${body.patient?.fullNameEn || ""}`);
    } else if (body.error === "duplicate_review_reason_required") {
      creationKey.current = null;
      setMessage(tr("A review reason is required to create a separate patient.", "سبب المراجعة مطلوب لإنشاء مريض مستقل."));
    } else {
      if (response.status >= 400 && response.status < 500) creationKey.current = null;
      setMessage(body.error || tr("Patient creation failed.", "تعذر إنشاء المريض."));
    }
    } catch {
      setMessage(tr(
        "Connection interrupted. Search patient records before retrying. Keep these details unchanged to safely retry the same request; check the central registry before starting a different registration.",
        "انقطع الاتصال. ابحث في سجلات المرضى قبل إعادة المحاولة. أبقِ البيانات دون تغيير عند إعادة نفس الطلب بأمان، وتحقق من السجل المركزي قبل بدء تسجيل مختلف.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDuplicateReview(null);
    setConfirmSeparate(false);
    setDuplicateReason("");
    await createPatient(payloadFrom(new FormData(event.currentTarget)));
  }

  async function createSeparateIdentity() {
    if (!duplicateReview || busy || !confirmSeparate) return;
    const reason = duplicateReason.trim();
    if (!reason) {
      setMessage(tr("Explain why this is a different patient.", "اشرح لماذا هذا مريض مختلف."));
      return;
    }
    await createPatient(duplicateReview.payload, reason);
  }

  const evidenceLabel = (code: DuplicateCandidate["evidence"][number]) =>
    code === "NAME_DOB"
      ? tr("Same normalized name + date of birth", "نفس الاسم المطبع + تاريخ الميلاد")
      : tr("Same phone", "نفس رقم الهاتف");

  return <form ref={formRef} className="catalog-form" onSubmit={submit}>
    <label>{tr("Full name (English)", "الاسم الكامل بالإنجليزية")}<input name="fullNameEn" required maxLength={220} /></label>
    <label dir="rtl">الاسم الكامل بالعربية<input name="fullNameAr" maxLength={220} dir="rtl" /></label>
    <label>{tr("Date of birth (optional)", "تاريخ الميلاد (اختياري)")}<SystemDateField name="dateOfBirth" /></label>
    <label>{tr("Age", "العمر")}<input name="recordedAgeValue" type="number" min="0" max={recordedAgeUnit === "DAY" ? 54787 : recordedAgeUnit === "MONTH" ? 1800 : 150} step="1" required /></label>
    <label>{tr("Age unit", "وحدة العمر")}<select name="recordedAgeUnit" value={recordedAgeUnit} onChange={event => setRecordedAgeUnit(event.target.value)} required><option value="YEAR">{tr("Years", "سنوات")}</option><option value="MONTH">{tr("Months", "أشهر")}</option><option value="DAY">{tr("Days", "أيام")}</option></select></label>
    <label>{tr("Sex", "الجنس")}<select name="sexAtBirth" defaultValue="" required><option value="" disabled>{tr("Select", "اختر")}</option><option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
    <label>{tr("Phone", "الهاتف")}<input name="phone" maxLength={50} /></label>
    <label>{tr("WhatsApp", "واتساب")}<input name="whatsapp" maxLength={50} /></label>
    <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" maxLength={191} /></label>
    <label>{tr("National ID", "الرقم الوطني")}<input name="nationalId" maxLength={120} /></label>
    <label>{tr("Nationality code", "رمز الجنسية")}<input name="nationalityCode" maxLength={2} placeholder={tr("ISO code", "رمز ISO")} /></label>

    {identifierSchemes.length > 0 && <section className="detail-card form-span">
      <div className="table-toolbar">
        <div>
          <h3>{tr("Additional Identifiers", "معرّفات إضافية")}</h3>
          <span>{tr("Insurance IDs, employee IDs, external MRNs and other configured identifiers.", "معرّفات التأمين والموظفين والأرقام الطبية الخارجية وغيرها من الأنواع المهيأة.")}</span>
        </div>
        {additionalIdentifiers.length < 10 && <button
          type="button"
          className="secondary-button"
          onClick={() => setAdditionalIdentifiers(items => [...items, { schemeId: identifierSchemes[0]?.id || "", value: "", issuingCountry: "" }])}
        >{tr("Add Identifier", "إضافة معرّف")}</button>}
      </div>
      {additionalIdentifiers.length === 0 ? <p className="muted">{tr("No additional identifiers.", "لا توجد معرّفات إضافية.")}</p> :
        <div className="summary-list">{additionalIdentifiers.map((item, index) => {
          const selected = identifierSchemes.find(scheme => scheme.id === item.schemeId);
          return <div key={index}>
            <span>
              <select value={item.schemeId} onChange={event => setAdditionalIdentifiers(items => items.map((row, rowIndex) => rowIndex === index ? { ...row, schemeId: event.target.value } : row))}>
                {identifierSchemes.map(scheme => <option key={scheme.id} value={scheme.id}>{scheme.code} — {locale === "ar" ? scheme.nameAr || scheme.nameEn : scheme.nameEn}</option>)}
              </select>
              <input value={item.value} maxLength={120} onChange={event => setAdditionalIdentifiers(items => items.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))} placeholder={tr("Identifier value", "قيمة المعرّف")} />
              {selected?.requiresIssuingCountry && <input value={item.issuingCountry} maxLength={2} onChange={event => setAdditionalIdentifiers(items => items.map((row, rowIndex) => rowIndex === index ? { ...row, issuingCountry: event.target.value } : row))} placeholder={tr("Country", "البلد")} />}
            </span>
            <button type="button" className="secondary-button" onClick={() => setAdditionalIdentifiers(items => items.filter((_, rowIndex) => rowIndex !== index))}>{tr("Remove", "إزالة")}</button>
          </div>;
        })}</div>}
    </section>}
    <label className="form-span">{tr("Address", "العنوان")}<textarea name="address" maxLength={4000} rows={2} dir="auto" /></label>
    <label>{tr("Clinical information", "المعلومات السريرية")}<textarea name="clinicalInformation" maxLength={4000} rows={3} /></label>
    <label>{tr("Notes", "ملاحظات")}<textarea name="notes" maxLength={4000} rows={3} /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Patient", "إنشاء المريض")}</button>

    {duplicateReview && <section className="detail-card form-span">
      <h3>{tr("Duplicate Review Required", "مراجعة التكرار مطلوبة")}</h3>
      <p className="form-warning">{tr(
        "Do not create a second identity unless you have reviewed these records and confirmed they are different people.",
        "لا تنشئ هوية ثانية قبل مراجعة هذه السجلات والتأكد أنها لأشخاص مختلفين.",
      )}</p>
      <div className="summary-list">
        {duplicateReview.candidates.map(candidate => <div key={candidate.id}>
          <span>
            <strong>{candidate.patientNumber} · {locale === "ar" ? candidate.fullNameAr || candidate.fullNameEn : candidate.fullNameEn}</strong>
            <small className="table-subtext">{candidate.dateOfBirth?.slice(0, 10) || "—"} · {candidate.phone || "—"}</small>
          </span>
          <strong>{candidate.evidence.map(evidenceLabel).join(" · ")}</strong>
        </div>)}
      </div>
      <label>{tr("Reason to create a separate patient", "سبب إنشاء مريض مستقل")}<textarea value={duplicateReason} onChange={event => setDuplicateReason(event.target.value)} maxLength={1000} rows={3} required /></label>
      <button type="button" className="secondary-button" disabled={busy || !duplicateReason.trim()} onClick={() => setConfirmSeparate(true)}>
        {tr("Reviewed — Create Separate Patient", "تمت المراجعة — إنشاء مريض مستقل")}
      </button>
    </section>}

    <CrudModal open={confirmSeparate && duplicateReview !== null}
      onClose={() => { if (!busy) setConfirmSeparate(false); }}
      size="compact"
      title={tr("Confirm Separate Patient Identity", "تأكيد إنشاء هوية مريض مستقلة")}
      description={tr(
        "This decision may create an irreversible duplicate medical identity. Compare the listed existing patients and document why the new person is different.",
        "قد يؤدي هذا القرار إلى إنشاء هوية طبية مكررة يصعب تصحيحها. راجع المرضى الحاليين ووثّق سبب اختلاف الشخص الجديد.",
      )}>
      {duplicateReview && <div className="catalog-form">
        <p className="form-warning form-span">{tr(
          "Do not proceed if any candidate is the same patient. Use the existing patient or a governed merge/review workflow.",
          "لا تتابع إذا كان أي سجل مرشح لنفس المريض. استخدم المريض الحالي أو مسار دمج ومراجعة مضبوط.",
        )}</p>
        <div className="form-span summary-list">
          {duplicateReview.candidates.map(candidate => <div key={candidate.id}>
            <strong>{candidate.patientNumber} · {locale === "ar"
              ? candidate.fullNameAr || candidate.fullNameEn : candidate.fullNameEn}</strong>
            <small>{candidate.evidence.map(evidenceLabel).join(" · ")}</small>
          </div>)}
        </div>
        <label className="form-span">{tr("Audited reason for separate identity (required)", "السبب المدقق لإنشاء هوية مستقلة (مطلوب)")}
          <textarea rows={3} minLength={10} maxLength={1000} required
            value={duplicateReason} onChange={event => setDuplicateReason(event.target.value)}/>
        </label>
        {message && <p className="form-warning form-span" role="alert">{message}</p>}
        <button type="button" className="primary-button form-span"
          disabled={busy || duplicateReason.trim().length < 10}
          onClick={() => void createSeparateIdentity()}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") :
            tr("Confirm this is a different patient", "تأكيد أن هذا شخص آخر")}
        </button>
      </div>}
    </CrudModal>

    {message && <div className={duplicateReview ? "form-warning form-span" : "form-success form-span"}>{message}</div>}
  </form>;
}
