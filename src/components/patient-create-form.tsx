"use client";

import { FormEvent, useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicateReview, setDuplicateReview] = useState<{ payload: PatientPayload; candidates: DuplicateCandidate[] } | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
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
      passportNumber: form.get("passportNumber"),
      passportIssuingCountry: form.get("passportIssuingCountry"),
      nationalityCode: form.get("nationalityCode"),
      addressEn: form.get("addressEn"),
      addressAr: form.get("addressAr"),
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
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    };

    if (response.ok) {
      const success = `${tr("Patient created", "تم إنشاء المريض")}: ${body.patient?.patientNumber || ""}`;
      setMessage(success);
      setDuplicateReview(null);
      setDuplicateReason("");
      formRef.current?.reset();
      setAdditionalIdentifiers([]);
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "possible_duplicates" && body.candidates?.length) {
      setDuplicateReview({ payload, candidates: body.candidates });
      setMessage(tr(
        "Potential duplicate identities require review before creating a separate patient.",
        "توجد هويات مريض محتملة التكرار ويجب مراجعتها قبل إنشاء مريض مستقل.",
      ));
    } else if (body.error === "identifier_already_used") {
      setMessage(`${tr("Identifier already belongs to another patient", "المعرّف مستخدم لمريض آخر")}: ${body.patient?.patientNumber || ""} ${body.patient?.fullNameEn || ""}`);
    } else if (body.error === "duplicate_review_reason_required") {
      setMessage(tr("A review reason is required to create a separate patient.", "سبب المراجعة مطلوب لإنشاء مريض مستقل."));
    } else {
      setMessage(body.error || tr("Patient creation failed.", "تعذر إنشاء المريض."));
    }
    setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDuplicateReview(null);
    setDuplicateReason("");
    await createPatient(payloadFrom(new FormData(event.currentTarget)));
  }

  async function createSeparateIdentity() {
    if (!duplicateReview) return;
    const reason = duplicateReason.trim();
    if (!reason) {
      setMessage(tr("Explain why this is a different patient.", "اشرح لماذا هذا مريض مختلف."));
      return;
    }
    if (!window.confirm(tr(
      "Confirm creation of a separate patient after duplicate review. The reason will be audited.",
      "تأكيد إنشاء مريض مستقل بعد مراجعة التكرار. سيتم حفظ السبب في سجل التدقيق.",
    ))) return;
    await createPatient(duplicateReview.payload, reason);
  }

  const evidenceLabel = (code: DuplicateCandidate["evidence"][number]) =>
    code === "NAME_DOB"
      ? tr("Same normalized name + date of birth", "نفس الاسم المطبع + تاريخ الميلاد")
      : tr("Same phone", "نفس رقم الهاتف");

  return <form ref={formRef} className="catalog-form" onSubmit={submit}>
    <label>{tr("Full name (English)", "الاسم الكامل بالإنجليزية")}<input name="fullNameEn" required maxLength={220} /></label>
    <label dir="rtl">الاسم الكامل بالعربية<input name="fullNameAr" maxLength={220} dir="rtl" /></label>
    <label>{tr("Date of birth", "تاريخ الميلاد")}<input name="dateOfBirth" type="date" /></label>
    <label>{tr("Sex at birth", "الجنس عند الولادة")}<select name="sexAtBirth" defaultValue="UNKNOWN"><option value="UNKNOWN">{tr("Unknown", "غير محدد")}</option><option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
    <label>{tr("Phone", "الهاتف")}<input name="phone" maxLength={50} /></label>
    <label>{tr("WhatsApp", "واتساب")}<input name="whatsapp" maxLength={50} /></label>
    <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" maxLength={191} /></label>
    <label>{tr("National ID", "الرقم الوطني")}<input name="nationalId" maxLength={120} /></label>
    <label>{tr("Passport number", "رقم جواز السفر")}<input name="passportNumber" maxLength={120} /></label>
    <label>{tr("Passport issuing country", "بلد إصدار الجواز")}<input name="passportIssuingCountry" maxLength={2} placeholder={tr("ISO code", "رمز ISO")} /></label>
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
    <label>{tr("Address (English)", "العنوان بالإنجليزية")}<textarea name="addressEn" maxLength={4000} rows={2} /></label>
    <label dir="rtl">{tr("Address (Arabic)", "العنوان بالعربية")}<textarea name="addressAr" maxLength={4000} rows={2} dir="rtl" /></label>
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
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void createSeparateIdentity()}>
        {tr("Reviewed — Create Separate Patient", "تمت المراجعة — إنشاء مريض مستقل")}
      </button>
    </section>}

    {message && <div className={duplicateReview ? "form-warning form-span" : "form-success form-span"}>{message}</div>}
  </form>;
}
