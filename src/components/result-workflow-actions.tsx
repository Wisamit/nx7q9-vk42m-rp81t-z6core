"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type Communication = {
  id: string;
  method: string;
  outcome: string;
  recipientName: string;
  recipientRole: string | null;
  acknowledgementConfirmed: boolean;
  readBackConfirmed: boolean;
  communicatedAt: string;
  communicatedBy: string;
};

type ValidationActor = {
  id: string;
  nameEn: string;
  nameAr: string | null;
  reviewedAt: string | null;
};

type ValidationReview = {
  id: string;
  stage: string;
  outcome: string;
  automated: boolean;
  reviewerNameEn: string | null;
  reviewerNameAr: string | null;
  reviewedAt: string;
  notes: string | null;
};

type ValidationSnapshot = {
  source?: string;
  code?: string;
  branchId?: string | null;
  nameEn?: string;
  nameAr?: string | null;
  requiresMedicalValidation?: boolean;
  allowSameReviewer?: boolean;
};

export function ResultWorkflowActions({
  resultId,
  resultStatus,
  validationStage,
  validationPolicySnapshot,
  technicalReviewer,
  medicalValidator,
  validationReviews,
  criticalCount,
  criticalEventStatus,
  criticalAcknowledgementDueAt,
  criticalEscalationLevel,
  criticalMaxEscalationLevel,
  criticalNextEscalationDueAt,
  criticalRequireReadBack,
  communications,
  canCommunicate,
  canMedicalValidate,
  canRelease,
  canAmend,
  locale,
}: {
  resultId: string;
  resultStatus: string;
  validationStage: string;
  validationPolicySnapshot: unknown;
  technicalReviewer: ValidationActor | null;
  medicalValidator: ValidationActor | null;
  validationReviews: ValidationReview[];
  criticalCount: number;
  criticalEventStatus: string | null;
  criticalAcknowledgementDueAt: string | null;
  criticalEscalationLevel: number;
  criticalMaxEscalationLevel: number | null;
  criticalNextEscalationDueAt: string | null;
  criticalRequireReadBack: boolean;
  communications: Communication[];
  canCommunicate: boolean;
  canMedicalValidate: boolean;
  canRelease: boolean;
  canAmend: boolean;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const methodLabel = (value: string) => ({
    PHONE: tr("Phone", "هاتف"),
    VERBAL: tr("Verbal", "شفهي"),
    EMAIL: tr("Email", "بريد إلكتروني"),
    SMS: tr("SMS", "رسالة نصية"),
    WHATSAPP: tr("WhatsApp", "واتساب"),
    OTHER: tr("Other", "أخرى"),
  }[value] || value);
  const outcomeLabel = (value: string) => ({
    ACKNOWLEDGED: tr("Acknowledged", "تم الإقرار"),
    NO_ANSWER: tr("No answer", "لا توجد إجابة"),
    LEFT_MESSAGE: tr("Left message", "تم ترك رسالة"),
    FAILED: tr("Failed", "فشل"),
    ESCALATED: tr("Escalated", "تم التصعيد"),
  }[value] || value);
  const validationStageLabel = (value: string) => ({
    ENTRY: tr("Entry", "الإدخال"),
    TECHNICAL_REVIEW: tr("Technical review", "المراجعة الفنية"),
    MEDICAL_VALIDATION: tr("Medical validation", "التحقق الطبي"),
    COMPLETE: tr("Complete", "مكتمل"),
  }[value] || value);
  const reviewStageLabel = (value: string) =>
    value === "MEDICAL_VALIDATION" ? tr("Medical validation", "التحقق الطبي") : tr("Technical review", "المراجعة الفنية");
  const reviewOutcomeLabel = (value: string) =>
    value === "RETURNED" ? tr("Returned", "أُعيد للتصحيح") : tr("Approved", "معتمد");
  const criticalStatusLabel = (value: string | null) => value ? sharedStatusLabel(locale, value) : tr("Open", "مفتوح");
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showCommunication, setShowCommunication] = useState(false);
  const [showAmendment, setShowAmendment] = useState(false);
  const [showMedicalReturn, setShowMedicalReturn] = useState(false);

  const snapshot = validationPolicySnapshot && typeof validationPolicySnapshot === "object"
    ? validationPolicySnapshot as ValidationSnapshot
    : null;
  const automatedTechnicalReview = validationReviews.find(review =>
    review.stage === "TECHNICAL_REVIEW" && review.outcome === "APPROVED" && review.automated
  ) || null;
  const technicalReviewerLabel = technicalReviewer
    ? (locale === "ar" ? technicalReviewer.nameAr || technicalReviewer.nameEn : technicalReviewer.nameEn)
    : automatedTechnicalReview ? tr("Automated", "آلي") : "—";
  const medicalValidatorLabel = medicalValidator
    ? (locale === "ar" ? medicalValidator.nameAr || medicalValidator.nameEn : medicalValidator.nameEn)
    : "—";

  async function submitCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("communication");
    setMessage("");

    const response = await fetch("/api/results/" + resultId + "/critical-communications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: form.get("method"),
        outcome: form.get("outcome"),
        recipientName: form.get("recipientName"),
        recipientRole: form.get("recipientRole"),
        recipientContact: form.get("recipientContact"),
        acknowledgementConfirmed: form.get("acknowledgementConfirmed") === "on",
        readBackConfirmed: form.get("readBackConfirmed") === "on",
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Critical result communication recorded.", "تم تسجيل التواصل بشأن النتيجة الحرجة."));
      setShowCommunication(false);
      router.refresh();
    } else if (body.error === "read_back_confirmation_required") {
      setMessage(tr("Acknowledgement requires read-back confirmation under the active critical escalation policy.", "يتطلب الإقرار تأكيد إعادة القراءة وفق سياسة تصعيد النتائج الحرجة الفعالة."));
    } else if (body.error === "critical_escalation_limit_reached") {
      setMessage(tr("Maximum configured critical escalation level has been reached.", "تم الوصول إلى الحد الأقصى المهيأ لمستوى تصعيد النتيجة الحرجة."));
    } else {
      setMessage(body.error || tr("Could not record communication.", "تعذر تسجيل التواصل."));
    }
    setBusy("");
  }

  async function approveMedicalValidation() {
    if (!confirm(tr(
      "Approve medical validation? This completes the required validation path and locks the result for release.",
      "اعتماد التحقق الطبي؟ سيؤدي ذلك إلى إكمال مسار التحقق المطلوب وقفل النتيجة تمهيداً للإصدار.",
    ))) return;

    setBusy("medical");
    setMessage("");
    let confirmQcWarnings = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch("/api/results/" + resultId + "/medical-validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", confirmQcWarnings }),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;

      if (response.ok) {
        setMessage(tr("Medical validation completed. The result is ready for controlled release.", "اكتمل التحقق الطبي. النتيجة جاهزة للإصدار المضبوط."));
        router.refresh();
        setBusy("");
        return;
      }

      if (body.error === "qc_warning_confirmation_required" && !confirmQcWarnings) {
        const reasons = Array.isArray(body.reasons)
          ? body.reasons.map(reason => typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "").filter(Boolean).join(", ")
          : "";
        const confirmed = confirm(tr(
          "QC has warning-level conditions" + (reasons ? ": " + reasons : "") + ". Confirm that you reviewed QC and continue medical validation?",
          "توجد حالات تحذير في QC" + (reasons ? ": " + reasons : "") + ". أكد أنك راجعت ضبط الجودة وتريد متابعة التحقق الطبي.",
        ));
        if (confirmed) {
          confirmQcWarnings = true;
          continue;
        }
      }

      if (body.error === "medical_validator_must_differ_from_technical_reviewer") {
        setMessage(tr("Medical validation requires a different authorized user under the snapshotted policy.", "تتطلب سياسة التحقق المحفوظة مستخدماً مخولاً مختلفاً عن منفذ المراجعة الفنية."));
      } else if (body.error === "validation_hold_review_required") {
        setMessage(tr("Medical validation is blocked until active blocking validation holds are resolved.", "التحقق الطبي محظور حتى تتم معالجة حجوزات التحقق المانعة النشطة."));
      } else if (body.error === "qc_blocking_hold") {
        setMessage(tr("Medical validation is blocked because analyzer QC is not acceptable.", "التحقق الطبي محظور لأن حالة ضبط جودة جهاز التحليل غير مقبولة."));
      } else {
        setMessage(typeof body.error === "string" ? body.error : tr("Medical validation failed.", "فشل التحقق الطبي."));
      }
      break;
    }

    setBusy("");
  }

  async function returnFromMedicalValidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;
    if (!confirm(tr(
      "Return this result for correction? The medical return and reason will remain in validation history.",
      "إعادة هذه النتيجة للتصحيح؟ ستبقى عملية الإعادة وسببها محفوظتين في سجل التحقق.",
    ))) return;

    setBusy("medical-return");
    setMessage("");
    const response = await fetch("/api/results/" + resultId + "/medical-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RETURN", reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (response.ok) {
      setMessage(tr("Result returned for correction and technical re-review.", "تمت إعادة النتيجة للتصحيح وإعادة المراجعة الفنية."));
      setShowMedicalReturn(false);
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not return the result.", "تعذر إعادة النتيجة."));
    }
    setBusy("");
  }

  async function releaseResult() {
    if (!confirm(tr("Release this verified result? A new immutable diagnostic report version will be created.", "هل تريد إصدار هذه النتيجة المتحقق منها؟ سيتم إنشاء إصدار تقرير تشخيصي جديد غير قابل للتغيير."))) return;
    setBusy("release");
    setMessage("");

    const response = await fetch("/api/results/" + resultId + "/release", { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Result released. Report version", "تم إصدار النتيجة. إصدار التقرير") + " " + body.reportVersion + " " + tr("created as", "أُنشئ بحالة") + " " + body.reportStatus + ".");
      router.refresh();
    } else if (body.error === "critical_acknowledgement_required") {
      setMessage(tr("Release blocked: the critical result must be communicated and acknowledged first.", "الإصدار محظور: يجب أولًا التواصل بشأن النتيجة الحرجة وتوثيق الإقرار بها."));
    } else {
      setMessage(body.error || tr("Result release failed.", "فشل إصدار النتيجة."));
    }
    setBusy("");
  }

  async function startAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;

    if (!confirm(tr("Start an amendment? The released result will remain preserved while a new version is prepared.", "بدء تعديل؟ ستبقى النتيجة الصادرة محفوظة بينما يتم إعداد إصدار جديد."))) return;

    setBusy("amend");
    setMessage("");

    const response = await fetch("/api/results/" + resultId + "/amend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Amendment version", "تم إنشاء إصدار التعديل") + " " + body.version + ".");
      setShowAmendment(false);
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not start amendment.", "تعذر بدء التعديل."));
    }
    setBusy("");
  }

  const criticalAcknowledged = criticalCount === 0 || criticalEventStatus === "ACKNOWLEDGED" || criticalEventStatus === "CLOSED";
  const canLogCriticalNow = criticalCount > 0 && canCommunicate
    && (["VERIFIED","RELEASED"].includes(resultStatus) || (resultStatus === "ENTERED" && validationStage === "MEDICAL_VALIDATION"));
  const pendingMedical = resultStatus === "ENTERED" && validationStage === "MEDICAL_VALIDATION";

  return <div className="result-workflow-box">
    <div className="result-workflow-status">
      <div><span>{tr("Result status", "حالة النتيجة")}</span><strong>{sharedStatusLabel(locale, resultStatus)}</strong></div>
      <div><span>{tr("Validation stage", "مرحلة التحقق")}</span><strong>{validationStageLabel(validationStage)}</strong></div>
      <div><span>{tr("Validation path", "مسار التحقق")}</span><strong>{snapshot?.requiresMedicalValidation ? tr("Technical → Medical", "فني ← طبي") : tr("Technical only", "فني فقط")}</strong></div>
      <div><span>{tr("Validation policy", "سياسة التحقق")}</span><strong>{snapshot?.code || tr("Default", "افتراضية")}{snapshot?.branchId ? " · " + tr("Branch override", "تجاوز فرع") : ""}</strong></div>
      <div><span>{tr("Technical reviewer", "المراجع الفني")}</span><strong>{technicalReviewerLabel}</strong></div>
      {snapshot?.requiresMedicalValidation && <div><span>{tr("Medical validator", "المعتمد الطبي")}</span><strong>{medicalValidatorLabel}</strong></div>}
      <div><span>{tr("Critical values", "القيم الحرجة")}</span><strong>{criticalCount}</strong></div>
      <div><span>{tr("Critical communication", "التواصل بشأن النتيجة الحرجة")}</span><strong>{criticalCount === 0 ? tr("Not required", "غير مطلوب") : criticalStatusLabel(criticalEventStatus)}</strong></div>
      {criticalCount > 0 && <div><span>{tr("Acknowledgement due", "موعد الإقرار")}</span><strong>{criticalAcknowledgementDueAt ? criticalAcknowledgementDueAt.replace("T"," ").slice(0,19) : tr("No policy", "لا توجد سياسة")}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Escalation level", "مستوى التصعيد")}</span><strong>{criticalEscalationLevel}{criticalMaxEscalationLevel !== null ? " / " + criticalMaxEscalationLevel : ""}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Next escalation due", "موعد التصعيد التالي")}</span><strong>{criticalNextEscalationDueAt ? criticalNextEscalationDueAt.replace("T"," ").slice(0,19) : "—"}</strong></div>}
    </div>

    <div className="result-actions">
      {canLogCriticalNow &&
        <button className="secondary-button" type="button" onClick={() => setShowCommunication(value => !value)}>{tr("Log Critical Communication", "تسجيل التواصل الحرج")}</button>}

      {pendingMedical && canMedicalValidate && <>
        <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => void approveMedicalValidation()}>
          {busy === "medical" ? tr("Validating…", "جارٍ التحقق…") : tr("Approve Medical Validation", "اعتماد التحقق الطبي")}
        </button>
        <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => setShowMedicalReturn(value => !value)}>
          {tr("Return for Correction", "إعادة للتصحيح")}
        </button>
      </>}

      {resultStatus === "VERIFIED" && validationStage === "COMPLETE" && canRelease &&
        <button className="primary-button" type="button" disabled={busy !== "" || !criticalAcknowledged} onClick={() => void releaseResult()}>
          {busy === "release" ? tr("Releasing…", "جارٍ الإصدار…") : tr("Release Result", "إصدار النتيجة")}
        </button>}

      {resultStatus === "RELEASED" && canAmend &&
        <button className="secondary-button" type="button" onClick={() => setShowAmendment(value => !value)}>{tr("Start Amendment", "بدء تعديل")}</button>}
    </div>

    {pendingMedical && !canMedicalValidate &&
      <p className="muted">{tr("Medical validation is required and must be completed by an authorized user.", "التحقق الطبي مطلوب ويجب إكماله بواسطة مستخدم مخول.")}</p>}

    {resultStatus === "VERIFIED" && validationStage === "COMPLETE" && !criticalAcknowledged &&
      <p className="form-error">{tr("Release is blocked until the critical result is communicated and acknowledgement is documented.", "الإصدار محظور حتى يتم التواصل بشأن النتيجة الحرجة وتوثيق الإقرار.")}</p>}

    {showMedicalReturn && <form className="catalog-form result-workflow-form" onSubmit={returnFromMedicalValidation}>
      <label className="form-span">{tr("Return reason", "سبب الإعادة")}
        <textarea name="reason" rows={3} required maxLength={1000} placeholder={tr("Explain why the result must be corrected and technically reviewed again…", "وضح سبب الحاجة إلى تصحيح النتيجة وإعادة مراجعتها فنياً…")} />
      </label>
      <button className="secondary-button form-span" disabled={busy === "medical-return"}>{busy === "medical-return" ? tr("Returning…", "جارٍ الإعادة…") : tr("Return to Technical Review", "إعادة إلى المراجعة الفنية")}</button>
    </form>}

    {showCommunication && <form className="catalog-form result-workflow-form" onSubmit={submitCommunication}>
      <label>{tr("Method", "الطريقة")}
        <select name="method" required defaultValue="PHONE">
          <option value="PHONE">{methodLabel("PHONE")}</option><option value="VERBAL">{methodLabel("VERBAL")}</option><option value="EMAIL">{methodLabel("EMAIL")}</option><option value="SMS">{methodLabel("SMS")}</option><option value="WHATSAPP">{methodLabel("WHATSAPP")}</option><option value="OTHER">{methodLabel("OTHER")}</option>
        </select>
      </label>
      <label>{tr("Outcome", "النتيجة")}
        <select name="outcome" required defaultValue="ACKNOWLEDGED">
          <option value="ACKNOWLEDGED">{outcomeLabel("ACKNOWLEDGED")}</option><option value="NO_ANSWER">{outcomeLabel("NO_ANSWER")}</option><option value="LEFT_MESSAGE">{outcomeLabel("LEFT_MESSAGE")}</option><option value="FAILED">{outcomeLabel("FAILED")}</option><option value="ESCALATED">{outcomeLabel("ESCALATED")}</option>
        </select>
      </label>
      <label>{tr("Recipient name", "اسم المستلم")}<input name="recipientName" required maxLength={200} /></label>
      <label>{tr("Recipient role", "صفة المستلم")}<input name="recipientRole" maxLength={150} placeholder={tr("Physician / nurse / patient / other", "طبيب / ممرض / مريض / أخرى")} /></label>
      <label className="form-span">{tr("Recipient contact", "بيانات تواصل المستلم")}<input name="recipientContact" maxLength={200} /></label>
      <label className="check-line"><input type="checkbox" name="acknowledgementConfirmed" /> {tr("Acknowledgement confirmed", "تم تأكيد الإقرار")}</label>
      <label className="check-line"><input type="checkbox" name="readBackConfirmed" /> {tr("Read-back confirmed", "تم تأكيد إعادة القراءة")}{criticalRequireReadBack ? " " + tr("(required for acknowledgement)", "(مطلوب للإقرار)") : ""}</label>
      <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy === "communication"}>{busy === "communication" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Communication", "حفظ التواصل")}</button>
    </form>}

    {showAmendment && <form className="catalog-form result-workflow-form" onSubmit={startAmendment}>
      <label className="form-span">{tr("Amendment reason", "سبب التعديل")}
        <textarea name="reason" rows={3} required maxLength={1000} placeholder={tr("Reason for correcting the released result…", "سبب تصحيح النتيجة الصادرة…")} />
      </label>
      <button className="primary-button form-span" disabled={busy === "amend"}>{busy === "amend" ? tr("Creating…", "جارٍ الإنشاء…") : tr("Create Amendment Version", "إنشاء إصدار تعديل")}</button>
    </form>}

    {validationReviews.length > 0 && <details className="specimen-history">
      <summary>{tr("Validation history", "سجل التحقق")} ({validationReviews.length})</summary>
      <div className="summary-list">
        {validationReviews.map(review => <div key={review.id}>
          <span>{review.reviewedAt.replace("T"," ").slice(0,19)} · {review.automated ? tr("Automated", "آلي") : (locale === "ar" ? review.reviewerNameAr || review.reviewerNameEn : review.reviewerNameEn) || "—"}</span>
          <strong>{reviewStageLabel(review.stage)} · {reviewOutcomeLabel(review.outcome)}{review.notes ? " · " + review.notes : ""}</strong>
        </div>)}
      </div>
    </details>}

    {communications.length > 0 && <details className="specimen-history">
      <summary>{tr("Critical communication history", "سجل التواصل بشأن النتائج الحرجة")} ({communications.length})</summary>
      <div className="summary-list">
        {communications.map(item => <div key={item.id}>
          <span>{item.communicatedAt.replace("T"," ").slice(0,19)} · {item.communicatedBy} · {methodLabel(item.method)}</span>
          <strong>{outcomeLabel(item.outcome)} · {item.recipientName}{item.recipientRole ? " (" + item.recipientRole + ")" : ""}{item.readBackConfirmed ? " · " + tr("read-back", "إعادة قراءة") : ""}</strong>
        </div>)}
      </div>
    </details>}

    {message && <p className="form-success">{message}</p>}
  </div>;
}
