import { SystemDateText } from "@/components/system-date-text";
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";
import { StaffStepUpDialog, type StepUpPurpose } from "@/components/staff-step-up-dialog";
import { CrudModal } from "@/components/crud-modal";

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
  performingBranchId,
  performingBranchTimezone,
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
  performingBranchId: string;
  performingBranchTimezone: string;
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
  const [stepUpPending,setStepUpPending]=useState<StepUpPurpose|null>(null);
  const [pendingAmendmentReason,setPendingAmendmentReason]=useState("");
  const [governedConfirmation,setGovernedConfirmation]=useState<"MEDICAL_APPROVAL"|"RESULT_RELEASE"|null>(null);
  const [qcWarningReasons,setQcWarningReasons]=useState<string[]|null>(null);
  const [qcReviewConfirmed,setQcReviewConfirmed]=useState(false);
  const [qcAcknowledgement,setQcAcknowledgement]=useState(false);

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
    if (busy || !canLogCriticalNow) return;
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

  async function approveMedicalValidation(stepUpToken?:string) {
    if(!stepUpToken) {
      if(busy || !canMedicalValidate || resultStatus!=="ENTERED" ||
        validationStage!=="MEDICAL_VALIDATION")return;
      setMessage("");
      setQcReviewConfirmed(false);
      setGovernedConfirmation("MEDICAL_APPROVAL");
      return;
    }
    if(busy || !canMedicalValidate || resultStatus!=="ENTERED" ||
      validationStage!=="MEDICAL_VALIDATION")return;
    setBusy("medical");
    setMessage("");
    try {
      const response=await fetch("/api/results/"+resultId+"/medical-validate",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-staff-step-up-token":stepUpToken},
        body:JSON.stringify({action:"APPROVE",confirmQcWarnings:qcReviewConfirmed}),
      });
      const body=await response.json().catch(()=>({})) as {
        error?:string;reasons?:Array<{code?:string}>;
      };
      if(response.ok){
        setQcReviewConfirmed(false);
        setQcWarningReasons(null);
        setMessage(tr(
          "Medical validation completed. The result is ready for controlled release.",
          "اكتمل التحقق الطبي. النتيجة جاهزة للإصدار المضبوط.",
        ));
        router.refresh();
        return;
      }
      if(body.error==="qc_warning_confirmation_required" && !qcReviewConfirmed){
        setQcWarningReasons(Array.isArray(body.reasons)
          ?body.reasons.filter(x=>x&&typeof x.code==="string").map(x=>String(x.code))
          :[]);
        setQcAcknowledgement(false);
        setMessage(tr("QC warning review and a NEW staff verification are required before proceeding.",
          "يلزم مراجعة تحذير ضبط الجودة وإجراء تحقق موظف جديد قبل المتابعة."));
        return;
      }
      setQcReviewConfirmed(false);
      if(body.error==="medical_validator_must_differ_from_technical_reviewer"){
        setMessage(tr("Medical validation requires a different authorized user under the snapshotted policy.",
          "تتطلب سياسة التحقق المحفوظة مستخدماً مخولاً مختلفاً عن منفذ المراجعة الفنية."));
      }else if(body.error==="technical_review_evidence_missing"){
        setMessage(tr("Medical validation requires a matching, approved technical review record for this result. Return the result for technical re-review.",
          "يتطلب الاعتماد الطبي سجل مراجعة فنية معتمداً ومطابقاً لهذه النتيجة. أعد النتيجة للمراجعة الفنية من جديد."));
      }else if(body.error==="medical_validation_policy_snapshot_invalid"){
        setMessage(tr("The medical validation policy snapshot is missing or inconsistent with this test/branch. Do not approve; escalate for clinical review.",
          "نسخة سياسة الاعتماد الطبي مفقودة أو لا تطابق هذا الفحص أو الفرع. لا تعتمد النتيجة؛ صعّدها للمراجعة السريرية."));
      }else if(body.error==="validation_hold_review_required"){
        setMessage(tr("Medical validation is blocked until active blocking validation holds are resolved.",
          "التحقق الطبي محظور حتى تتم معالجة حجوزات التحقق المانعة النشطة."));
      }else if(body.error==="qc_blocking_hold"){
        setMessage(tr("Medical validation is blocked because analyzer QC is not acceptable.",
          "التحقق الطبي محظور لأن حالة ضبط جودة جهاز التحليل غير مقبولة."));
      }else{
        setMessage(body.error||tr("Medical validation failed.","فشل التحقق الطبي."));
      }
    }catch{
      setQcReviewConfirmed(false);
      setMessage(tr("Connection interrupted. Check the validation record before using a fresh staff verification.",
        "انقطع الاتصال؛ تحقق من سجل الاعتماد قبل استخدام تحقق موظف جديد."));
    }finally{setBusy("");}
  }

  async function returnFromMedicalValidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !pendingMedical || !canMedicalValidate) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;

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

  async function releaseResult(stepUpToken?:string) {
    if(!stepUpToken) {
      if(busy || !canRelease || resultStatus!=="VERIFIED" ||
        validationStage!=="COMPLETE")return;
      setMessage("");
      setGovernedConfirmation("RESULT_RELEASE");
      return;
    }
    if(busy || !canRelease || resultStatus!=="VERIFIED" ||
      validationStage!=="COMPLETE")return;
    setBusy("release");
    setMessage("");
    try{
      const response=await fetch("/api/results/"+resultId+"/release",{
        method:"POST",headers:{"x-staff-step-up-token":stepUpToken},
      });
      const body=await response.json().catch(()=>({})) as {
        error?:string;reportVersion?:string;reportStatus?:string;
      };
      if(response.ok){
        setMessage(tr("Result released. Report version","تم إصدار النتيجة. إصدار التقرير")+
          " "+(body.reportVersion||"—")+" "+
          tr("created as","أُنشئ بحالة")+" "+(body.reportStatus||"—")+".");
        router.refresh();
      }else if(body.error==="critical_acknowledgement_required"){
        setMessage(tr("Release blocked: the critical result must be communicated and acknowledged first.",
          "الإصدار محظور: يجب أولًا التواصل بشأن النتيجة الحرجة وتوثيق الإقرار بها."));
      }else if(body.error==="specimen_custody_changed_blocks_release"){
        setMessage(tr("Release blocked: the source specimen was moved, rejected, disposed or no longer belongs to the performing branch. Recheck custody and clinical review.",
          "الإصدار محظور: تغيّر موقع أو وضع العينة الأصلية، أو لم تعد في فرع التنفيذ. راجع تتبع العينة واعتماد النتيجة."));
      }else{
        setMessage(body.error||tr("Result release failed.","فشل إصدار النتيجة."));
      }
    }catch{
      setMessage(tr("Connection interrupted. Check published report versions before retrying release.",
        "انقطع الاتصال. تحقق من إصدارات التقرير المنشورة قبل إعادة محاولة الإصدار."));
    }finally{setBusy("");}
  }

  async function startAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || resultStatus !== "RELEASED" || !canAmend) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;


    setPendingAmendmentReason(reason);
    setStepUpPending("RESULT_AMEND");
  }

  async function commitAmendment(reason: string, stepUpToken: string) {
    setBusy("amend");
    setMessage("");

    const response = await fetch("/api/results/" + resultId + "/amend", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-staff-step-up-token": stepUpToken },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Amendment version", "تم إنشاء إصدار التعديل") + " " + body.version + ".");
      setShowAmendment(false);
      router.refresh();
    } else {
      const refusal = body.error === "fresh_staff_reauthentication_required" ||
        body.error === "step_up_already_used_or_expired" ||
        body.error === "step_up_session_or_branch_changed"
          ? tr("A fresh approval proof is required for this amendment.", "يلزم تأكيد هوية جديد لهذا التعديل.")
          : body.error === "newer_result_version_already_exists_or_changed"
            ? tr("Result changed or another amendment version exists. Refresh and review.", "تغيرت النتيجة أو يوجد إصدار تعديل آخر. حدّث الصفحة وراجع.")
            : body.error || tr("Could not start amendment.", "تعذر بدء التعديل.");
      setMessage(refusal);
    }
    setBusy("");
  }

  const criticalAcknowledged = criticalCount === 0 || criticalEventStatus === "ACKNOWLEDGED" || criticalEventStatus === "CLOSED";
  const canLogCriticalNow = criticalCount > 0 && canCommunicate
    && (["VERIFIED","RELEASED"].includes(resultStatus) || (resultStatus === "ENTERED" && validationStage === "MEDICAL_VALIDATION"));
  const pendingMedical = resultStatus === "ENTERED" && validationStage === "MEDICAL_VALIDATION";

  return <div className="result-workflow-box">
    <StaffStepUpDialog open={stepUpPending!==null}
      action={stepUpPending||"MEDICAL_APPROVAL"} resourceKey={resultId}
      branchId={performingBranchId} locale={locale}
      onCancel={()=>{setStepUpPending(null);setPendingAmendmentReason("");setQcReviewConfirmed(false);}}
      onGranted={token=>{
        const action=stepUpPending;setStepUpPending(null);
        if(action==="MEDICAL_APPROVAL")void approveMedicalValidation(token);
        if(action==="RESULT_RELEASE")void releaseResult(token);
        if(action==="RESULT_AMEND"){
          const reason=pendingAmendmentReason;
          setPendingAmendmentReason("");
          if(reason)void commitAmendment(reason,token);
        }
      }}/>
    <CrudModal open={governedConfirmation!==null}
      onClose={()=>{if(!busy)setGovernedConfirmation(null);}}
      size="compact"
      title={governedConfirmation==="MEDICAL_APPROVAL"
        ?tr("Approve Medical Validation","اعتماد التحقق الطبي")
        :tr("Release Diagnostic Result","إصدار نتيجة تشخيصية")}
      description={tr(
        "This is a governed clinical decision. Fresh staff verification is required, and server-side QC, critical communication, custody and result-version gates cannot be bypassed.",
        "هذا قرار سريري محكوم. يلزم تحقق موظف جديد؛ لا يمكن تجاوز قيود ضبط الجودة والإبلاغ عن النتائج الحرجة وتتبع العينة وإصدارات النتائج.",
      )}>
      {governedConfirmation&&<div className="catalog-form">
        <p className="form-span"><strong>{sharedStatusLabel(locale,resultStatus)}</strong> ·
          {validationStageLabel(validationStage)}</p>
        <p className="form-span">{governedConfirmation==="MEDICAL_APPROVAL"
          ?tr("Medical approval locks the result for controlled release. Review QC warnings, clinical context and any independent technical review.",
            "يقفل الاعتماد الطبي النتيجة استعداداً للإصدار المضبوط. راجع تحذيرات الجودة والسياق الطبي والمراجعة الفنية المستقلة.")
          :tr("Release creates a NEW immutable diagnostic report version. Released history is never overwritten.",
            "ينشئ الإصدار نسخة جديدة ثابتة من التقرير التشخيصي. لا يُستبدل التاريخ السريري الصادر.")}</p>
        {message&&<p className="form-warning form-span" role="alert">{message}</p>}
        <button type="button" className="primary-button form-span" disabled={Boolean(busy)}
          onClick={()=>{
            if(!governedConfirmation)return;
            setStepUpPending(governedConfirmation);
            setGovernedConfirmation(null);
          }}>
          {tr("Continue to independent staff verification","المتابعة إلى تحقق الموظف المستقل")}
        </button>
      </div>}
    </CrudModal>
    <CrudModal open={qcWarningReasons!==null}
      onClose={()=>{if(!busy){setQcWarningReasons(null);setQcAcknowledgement(false);setQcReviewConfirmed(false);}}}
      size="compact"
      title={tr("Review Analyzer QC Warnings","مراجعة تحذيرات ضبط جودة الأجهزة")}
      description={tr(
        "The server returned QC warning-level conditions. Do not proceed without qualified clinical review; QC blocking holds remain non-overridable.",
        "أعاد السيرفر تحذيرات ضبط جودة. لا تتابع دون مراجعة سريرية مؤهلة؛ يبقى حظر ضبط الجودة المانع غير قابل للتجاوز.",
      )}>
      {qcWarningReasons!==null&&<form className="catalog-form" onSubmit={event=>{
        event.preventDefault();
        if(!qcAcknowledgement||busy||!canMedicalValidate)return;
        setQcReviewConfirmed(true);
        setQcWarningReasons(null);
        setQcAcknowledgement(false);
        setStepUpPending("MEDICAL_APPROVAL");
      }}>
        <div className="form-span">
          <p>{tr("Warning codes returned by current QC gate","رموز التحذير الصادرة عن ضبط الجودة الحالي")}:</p>
          <ul>{qcWarningReasons.map((code,i)=><li key={code+"-"+i}>{code}</li>)}</ul>
        </div>
        <label className="form-span">
          <input type="checkbox" required checked={qcAcknowledgement}
            onChange={event=>setQcAcknowledgement(event.target.checked)}/>
          {tr("I reviewed these QC warning conditions and accept accountability for requesting a new independent staff verification.",
            "راجعت ظروف تحذير ضبط الجودة وأتحمل مسؤولية طلب تحقق موظف مستقل جديد.")}
        </label>
        {message&&<p className="form-warning form-span" role="alert">{message}</p>}
        <button type="submit" className="primary-button form-span"
          disabled={Boolean(busy)||!qcAcknowledgement}>
          {tr("Continue with NEW staff verification","المتابعة بتحقق موظف جديد")}
        </button>
      </form>}
    </CrudModal>
    <div className="result-workflow-status">
      <div><span>{tr("Result status", "حالة النتيجة")}</span><strong>{sharedStatusLabel(locale, resultStatus)}</strong></div>
      <div><span>{tr("Validation stage", "مرحلة التحقق")}</span><strong>{validationStageLabel(validationStage)}</strong></div>
      <div><span>{tr("Validation path", "مسار التحقق")}</span><strong>{snapshot?.requiresMedicalValidation ? tr("Technical → Medical", "فني ← طبي") : tr("Technical only", "فني فقط")}</strong></div>
      <div><span>{tr("Validation policy", "سياسة التحقق")}</span><strong>{snapshot?.code || tr("Default", "افتراضية")}{snapshot?.branchId ? " · " + tr("Branch override", "تجاوز فرع") : ""}</strong></div>
      <div><span>{tr("Technical reviewer", "المراجع الفني")}</span><strong>{technicalReviewerLabel}</strong></div>
      {snapshot?.requiresMedicalValidation && <div><span>{tr("Medical validator", "المعتمد الطبي")}</span><strong>{medicalValidatorLabel}</strong></div>}
      <div><span>{tr("Critical values", "القيم الحرجة")}</span><strong>{criticalCount}</strong></div>
      <div><span>{tr("Critical communication", "التواصل بشأن النتيجة الحرجة")}</span><strong>{criticalCount === 0 ? tr("Not required", "غير مطلوب") : criticalStatusLabel(criticalEventStatus)}</strong></div>
      {criticalCount > 0 && <div><span>{tr("Acknowledgement due", "موعد الإقرار")}</span><strong>{criticalAcknowledgementDueAt ? <SystemDateText value={criticalAcknowledgementDueAt} timeZone={performingBranchTimezone} /> : tr("No policy", "لا توجد سياسة")}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Escalation level", "مستوى التصعيد")}</span><strong>{criticalEscalationLevel}{criticalMaxEscalationLevel !== null ? " / " + criticalMaxEscalationLevel : ""}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Next escalation due", "موعد التصعيد التالي")}</span><strong>{criticalNextEscalationDueAt ? <SystemDateText value={criticalNextEscalationDueAt} timeZone={performingBranchTimezone} /> : "—"}</strong></div>}
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

    <CrudModal open={showMedicalReturn} onClose={() => { if (!busy) setShowMedicalReturn(false); }}
      size="compact"
      title={tr("Return Result for Technical Correction", "إعادة النتيجة للمراجعة الفنية")}
      description={tr("This governed medical return is recorded in validation history and requires a documented reason. It does not delete the earlier result.", "تُوثق الإعادة الطبية في تاريخ التحقق ويجب تقديم سبب؛ لا يتم حذف النتيجة السابقة.")}>
      {showMedicalReturn && <form className="catalog-form result-workflow-form" onSubmit={returnFromMedicalValidation}>
      <label className="form-span">{tr("Return reason", "سبب الإعادة")}
        <textarea name="reason" rows={3} required maxLength={1000} placeholder={tr("Explain why the result must be corrected and technically reviewed again…", "وضح سبب الحاجة إلى تصحيح النتيجة وإعادة مراجعتها فنياً…")} />
      </label>
      <button className="secondary-button form-span" disabled={busy === "medical-return"}>{busy === "medical-return" ? tr("Returning…", "جارٍ الإعادة…") : tr("Return to Technical Review", "إعادة إلى المراجعة الفنية")}</button>
    </form>}
      {showMedicalReturn && message && <p role="status" className="form-warning">{message}</p>}
    </CrudModal>

    <CrudModal open={showCommunication} onClose={() => { if (!busy) setShowCommunication(false); }}
      size="compact"
      title={tr("Log Critical Result Communication", "توثيق التواصل بشأن نتيجة حرجة")}
      description={tr("Document the actual recipient, method, outcome and read-back. Do not claim acknowledgement until independently confirmed.", "وثّق المستلم وطريقة التواصل والنتيجة وإعادة القراءة الفعلية؛ لا تسجل الإقرار قبل التأكد منه.")}>
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
      {showCommunication && message && <p role="status" className="form-warning">{message}</p>}
    </CrudModal>

    <CrudModal open={showAmendment} onClose={() => { if (!busy) setShowAmendment(false); }}
      size="compact"
      title={tr("Start Released Result Amendment", "بدء إصدار تعديل للنتيجة الصادرة")}
      description={tr("A released result and report are never overwritten. This operation requires a reason and a fresh independent staff step-up; the prior version is preserved.", "لا تُستبدل النتائج والتقارير الصادرة؛ يلزم سبب موثق وتحقق موظف إضافي جديد، وتبقى النسخة السابقة محفوظة.")}>
      {showAmendment && <form className="catalog-form result-workflow-form" onSubmit={startAmendment}>
      <label className="form-span">{tr("Amendment reason", "سبب التعديل")}
        <textarea name="reason" rows={3} required maxLength={1000} placeholder={tr("Reason for correcting the released result…", "سبب تصحيح النتيجة الصادرة…")} />
      </label>
      <button className="primary-button form-span" disabled={busy === "amend"}>{busy === "amend" ? tr("Creating…", "جارٍ الإنشاء…") : tr("Create Amendment Version", "إنشاء إصدار تعديل")}</button>
    </form>}
      {showAmendment && message && <p role="status" className="form-warning">{message}</p>}
    </CrudModal>

    {validationReviews.length > 0 && <details className="specimen-history">
      <summary>{tr("Validation history", "سجل التحقق")} ({validationReviews.length})</summary>
      <div className="summary-list">
        {validationReviews.map(review => <div key={review.id}>
          <span>{<SystemDateText value={review.reviewedAt} timeZone={performingBranchTimezone} />} · {review.automated ? tr("Automated", "آلي") : (locale === "ar" ? review.reviewerNameAr || review.reviewerNameEn : review.reviewerNameEn) || "—"}</span>
          <strong>{reviewStageLabel(review.stage)} · {reviewOutcomeLabel(review.outcome)}{review.notes ? " · " + review.notes : ""}</strong>
        </div>)}
      </div>
    </details>}

    {communications.length > 0 && <details className="specimen-history">
      <summary>{tr("Critical communication history", "سجل التواصل بشأن النتائج الحرجة")} ({communications.length})</summary>
      <div className="summary-list">
        {communications.map(item => <div key={item.id}>
          <span>{<SystemDateText value={item.communicatedAt} timeZone={performingBranchTimezone} />} · {item.communicatedBy} · {methodLabel(item.method)}</span>
          <strong>{outcomeLabel(item.outcome)} · {item.recipientName}{item.recipientRole ? " (" + item.recipientRole + ")" : ""}{item.readBackConfirmed ? " · " + tr("read-back", "إعادة قراءة") : ""}</strong>
        </div>)}
      </div>
    </details>}

    {message && <p className="form-success">{message}</p>}
  </div>;
}
