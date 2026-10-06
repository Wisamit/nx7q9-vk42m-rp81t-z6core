"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type ResultField = {
  componentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
  unit: string | null;
  currentValue: string;
  currentFlag: string | null;
  referenceDisplay: string | null;
  critical: boolean;
  deltaEvaluation: string | null;
  deltaDisplay: string | null;
  calculated: boolean;
};

type CommentTemplateOption = {
  id: string;
  code: string;
  nameEn: string;
  textEn: string;
};

export function ResultEntryForm({
  orderItemId,
  specimenId,
  performingBranchId,
  fields,
  comments,
  resultId,
  resultStatus,
  resultSource,
  analyzerLabel,
  canVerify,
  commentTemplates,
  locale,
}: {
  orderItemId: string;
  specimenId: string;
  performingBranchId: string;
  fields: ResultField[];
  comments: string;
  resultId: string | null;
  resultStatus: string | null;
  resultSource: string;
  analyzerLabel?: string | null;
  canVerify: boolean;
  commentTemplates: CommentTemplateOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const resultTypeLabel = (value: string) => ({
    NUMERIC: tr("Numeric", "رقمي"),
    TEXT: tr("Text", "نصي"),
    QUALITATIVE: tr("Qualitative", "نوعي"),
    BOOLEAN: tr("Yes / No", "نعم / لا"),
    DATE: tr("Date", "تاريخ"),
  }[value] || value);
  const sourceLabel = (value: string) => ({
    MANUAL: tr("Manual", "يدوي"),
    ANALYZER: tr("Analyzer", "جهاز تحليل"),
    IMPORT: tr("Import", "استيراد"),
    CALCULATED: tr("Calculated", "محسوب"),
  }[value] || value);
  const flagLabel = (value: string) => ({
    NORMAL: tr("Normal", "طبيعي"),
    LOW: tr("Low", "منخفض"),
    HIGH: tr("High", "مرتفع"),
    CRITICAL_LOW: tr("Critical low", "منخفض حرج"),
    CRITICAL_HIGH: tr("Critical high", "مرتفع حرج"),
    ABNORMAL: tr("Abnormal", "غير طبيعي"),
  }[value] || value);
  const deltaLabel = (value: string) => ({
    NO_PREVIOUS_RESULT: tr("No previous result", "لا توجد نتيجة سابقة"),
    WITHIN_LIMIT: tr("Within limit", "ضمن الحد"),
    EXCEEDED: tr("Exceeded", "متجاوز"),
  }[value] || value);
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.componentId || "__TEST__", field.currentValue])),
  );
  const [note, setNote] = useState(comments);
  const [savedResultId, setSavedResultId] = useState(resultId);
  const [savedStatus, setSavedStatus] = useState(resultStatus);
  const [complete, setComplete] = useState(Boolean(resultId && resultStatus === "ENTERED"));
  const [busy, setBusy] = useState<"save" | "verify" | "">("");
  const [message, setMessage] = useState("");

  function fieldInput(field: ResultField) {
    const key = field.componentId || "__TEST__";
    if (field.calculated) return <div className="calculated-value-box"><strong>{values[key] || tr("Calculated on save", "يُحسب عند الحفظ")}</strong><small>{tr("Derived from configured formula", "مشتق من معادلة مهيأة")}</small></div>;

    const common = {
      value: values[key] || "",
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };

    if (field.resultType === "BOOLEAN") {
      return <select {...common}>
        <option value="">—</option>
        <option value="true">{tr("True", "نعم")}</option>
        <option value="false">{tr("False", "لا")}</option>
      </select>;
    }
    if (field.resultType === "DATE") return <input type="date" {...common} />;
    if (field.resultType === "NUMERIC") return <input inputMode="decimal" placeholder={tr("Numeric result", "نتيجة رقمية")} {...common} />;
    if (field.resultType === "TEXT") return <textarea rows={2} placeholder={tr("Result text", "نص النتيجة")} {...common} />;
    return <input placeholder={tr("Qualitative result", "نتيجة وصفية")} {...common} />;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage("");

    const response = await fetch("/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId,
        specimenId,
        performingBranchId,
        comments: note,
        values: fields.map((field) => ({
          componentId: field.componentId,
          rawValue: values[field.componentId || "__TEST__"] || "",
        })),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setSavedResultId(body.result?.id || null);
      setSavedStatus(body.result?.status || null);
      setComplete(Boolean(body.complete));
      const notices = [];
      if (body.criticalCount > 0) notices.push(`${body.criticalCount} ${tr("critical value(s)", "قيمة حرجة")}`);
      if (body.deltaExceededCount > 0) notices.push(`${body.deltaExceededCount} ${tr("delta warning(s)", "تحذير فرق")}`);
      if (body.pendingReflexCount > 0) notices.push(`${body.pendingReflexCount} ${tr("reflex recommendation(s)", "توصية فحص انعكاسي")}`);
      if (body.blockingValidationHoldCount > 0) notices.push(`${body.blockingValidationHoldCount} ${tr("blocking validation hold(s)", "حجز تحقق مانع")}`);
      if (body.warningValidationHoldCount > 0) notices.push(`${body.warningValidationHoldCount} ${tr("validation warning(s)", "تحذير تحقق")}`);
      setMessage(body.autoVerified
        ? tr("Result saved and autoverified by the active clinical policy. Release remains a separate controlled action.", "تم حفظ النتيجة والتحقق منها تلقائيًا حسب السياسة السريرية الفعالة. يبقى الإصدار إجراءً مستقلاً ومضبوطًا.")
        : notices.length
          ? `${tr("Saved with", "تم الحفظ مع")}: ${notices.join(", ")}. ${tr("Review validation items before verification.", "راجع عناصر التحقق قبل اعتماد النتيجة.")}`
          : body.complete ? tr("Result saved and ready for verification.", "تم حفظ النتيجة وهي جاهزة للتحقق.") : tr("Draft saved. Complete all required result fields before verification.", "تم حفظ المسودة. أكمل جميع حقول النتيجة المطلوبة قبل التحقق."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Result could not be saved.", "تعذر حفظ النتيجة."));
    }
    setBusy("");
  }

  async function verify() {
    if (!savedResultId) return;
    if (!confirm(tr("Verify this result? Verified values become locked and later changes require an amendment.", "هل تريد التحقق من هذه النتيجة؟ بعد التحقق تُقفل القيم وأي تغيير لاحق يتطلب تعديلًا موثقًا."))) return;

    setBusy("verify");
    setMessage("");
    let confirmDeltaWarnings = false;
    let confirmQcWarnings = false;
    let response: Response | null = null;
    let body: Record<string, unknown> = {};

    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`/api/results/${savedResultId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmDeltaWarnings, confirmQcWarnings }),
      });
      body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) break;

      if (body.error === "qc_warning_confirmation_required" && !confirmQcWarnings) {
        const reasons = Array.isArray(body.reasons)
          ? body.reasons.map((reason) => typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "").filter(Boolean).join(", ")
          : "";
        const confirmed = confirm(tr(`QC has warning-level conditions${reasons ? ": " + reasons : ""}. Confirm that you reviewed QC and continue verification?`, `توجد حالات تحذير في QC${reasons ? ": " + reasons : ""}. أكد أنك راجعت ضبط الجودة وتريد متابعة التحقق.`));
        if (!confirmed) break;
        confirmQcWarnings = true;
        continue;
      }

      if (body.error === "delta_review_confirmation_required" && !confirmDeltaWarnings) {
        const count = typeof body.deltaExceededCount === "number" ? body.deltaExceededCount : 0;
        const confirmed = confirm(tr(`${count} delta-check warning(s) exceeded configured limits. Confirm that you reviewed these warnings and continue verification?`, `${count} تحذير دلتا تجاوز الحدود المهيأة. أكد أنك راجعت هذه التحذيرات وتريد متابعة التحقق.`));
        if (!confirmed) break;
        confirmDeltaWarnings = true;
        continue;
      }

      break;
    }

    if (response?.ok) {
      const resultStatus = typeof body.resultStatus === "string" ? body.resultStatus : "VERIFIED";
      const criticalCount = typeof body.criticalCount === "number" ? body.criticalCount : 0;
      setSavedStatus(resultStatus);
      setMessage(criticalCount > 0
        ? tr("Result verified. Critical result acknowledgement/communication is required before release.", "تم التحقق من النتيجة. يلزم توثيق التواصل والإقرار بالنتيجة الحرجة قبل الإصدار.")
        : tr("Result verified successfully.", "تم التحقق من النتيجة بنجاح."));
      router.refresh();
    } else if (body.error === "reflex_review_required") {
      setMessage(tr("Verification blocked: review all pending reflex recommendations first.", "التحقق محظور: راجع أولاً جميع توصيات الفحوص الانعكاسية المعلقة."));
    } else if (body.error === "validation_hold_review_required") {
      setMessage(tr("Verification blocked: resolve all active blocking validation holds first.", "التحقق محظور: عالج أولاً جميع حجوزات التحقق المانعة النشطة."));
    } else if (body.error === "qc_blocking_hold") {
      setMessage(tr("Verification blocked: analyzer QC is not currently acceptable. Review QC status and open QC violations.", "التحقق محظور: حالة ضبط الجودة للجهاز غير مقبولة حالياً. راجع حالة QC والمخالفات المفتوحة."));
    } else {
      setMessage(tr("Result verification failed.", "فشل التحقق من النتيجة."));
    }
    setBusy("");
  }

  const statusLocked = ["VERIFIED", "RELEASED", "AMENDED", "CANCELLED"].includes(savedStatus || "");
  const sourceLocked = resultSource !== "MANUAL";
  const locked = statusLocked || sourceLocked;

  return <form className="result-entry-form" onSubmit={save}>
    <div className="result-entry-header">
      <div><strong>{tr("Status", "الحالة")}</strong><span>{savedStatus ? sharedStatusLabel(locale, savedStatus) : tr("Not entered", "غير مدخل")}</span></div>
      <div><strong>{tr("Source", "المصدر")}</strong><span>{sourceLabel(resultSource)}{analyzerLabel ? ` · ${analyzerLabel}` : ""}</span></div>
    </div>

    <div className="result-field-list">
      {fields.map((field) => {
        const key = field.componentId || "__TEST__";
        return <div className={`result-field-row ${field.critical ? "result-critical" : ""}`} key={key}>
          <div className="result-field-name">
            <strong>{field.code} — {locale === "ar" ? field.nameAr || field.nameEn : field.nameEn}</strong>
            {locale !== "ar" && field.nameAr && <small dir="rtl">{field.nameAr}</small>}
            <small>{resultTypeLabel(field.resultType)}{field.unit ? ` · ${field.unit}` : ""}</small>
          </div>
          <div className="result-field-input">{locked ? <strong>{values[key] || "—"}</strong> : fieldInput(field)}</div>
          <div className="result-field-reference">
            <span>{field.referenceDisplay || tr("No active reference interval", "لا يوجد مدى مرجعي نشط")}</span>
            {field.currentFlag && <strong>{flagLabel(field.currentFlag)}</strong>}
            {field.deltaEvaluation && field.deltaEvaluation !== "NOT_CONFIGURED" && <span className={field.deltaEvaluation === "EXCEEDED" ? "delta-exceeded" : "delta-ok"}>
              {tr("Delta", "دلتا")}: {field.deltaDisplay || deltaLabel(field.deltaEvaluation)}
            </span>}
          </div>
        </div>;
      })}
    </div>

    <label className="result-comments">{tr("Comments", "التعليقات")}
      {!locked && commentTemplates.length > 0 && <select
        defaultValue=""
        onChange={(event) => {
          const template = commentTemplates.find((item) => item.id === event.target.value);
          if (template) setNote((current) => current ? current + "\n" + template.textEn : template.textEn);
          event.target.value = "";
        }}
      >
        <option value="">{tr("Insert comment template…", "إدراج قالب تعليق…")}</option>
        {commentTemplates.map((template) => <option key={template.id} value={template.id}>{template.code} — {template.nameEn}</option>)}
      </select>}
      <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} disabled={locked} />
    </label>

    {message && <div className="form-success">{message}</div>}

    <div className="result-actions">
      {!locked && <button className="primary-button" disabled={busy !== ""}>{busy === "save" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Result", "حفظ النتيجة")}</button>}
      {!statusLocked && canVerify && savedResultId && complete && <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>{busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Result", "التحقق من النتيجة")}</button>}
      {statusLocked && <span className="muted">{tr("Verified/released results are locked. Future edits must use an amendment workflow.", "النتائج التي تم التحقق منها أو إصدارها مقفلة، وأي تعديل لاحق يجب أن يتم عبر مسار التعديل الرسمي.")}</span>}
      {!statusLocked && sourceLocked && <span className="muted">{tr("Analyzer/import-origin values are read-only here. Use the analyzer integration workflow for additional observations or corrections.", "القيم الواردة من الجهاز أو الاستيراد للقراءة فقط هنا. استخدم مسار تكامل أجهزة التحليل لإضافة مشاهدات أو تصحيحات.")}</span>}
    </div>
  </form>;
}
