"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";
import { focusNextResultEntryControl, shouldAdvanceResultEntryOnEnter } from "@/lib/result-entry-keyboard";
import { commentTemplateTargetMatches } from "@/lib/result-comments";

type QualitativeResultOption = {
  id: string;
  code: string;
  valueEn: string;
  valueAr: string | null;
  flag: string;
  isAbnormal: boolean;
  isCritical: boolean;
};

type ResultEntryLayout = "STANDARD" | "SECTIONED" | "COMPACT_GRID";

type ResultSection = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
};

type ResultField = {
  componentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
  unit: string | null;
  resultSectionId: string | null;
  currentValue: string;
  currentComment: string;
  currentOptionId: string | null;
  qualitativeOptions: QualitativeResultOption[];
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
  nameAr: string | null;
  textEn: string;
  textAr: string | null;
  scope: "ORGANIZATION" | "TEST" | "COMPONENT";
  testId: string | null;
  componentId: string | null;
};

export function ResultEntryForm({
  orderItemId,
  testId,
  specimenId,
  performingBranchId,
  fields,
  resultEntryLayout,
  resultSections,
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
  testId: string;
  specimenId: string;
  performingBranchId: string;
  fields: ResultField[];
  resultEntryLayout: ResultEntryLayout;
  resultSections: ResultSection[];
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
    POSITIVE: tr("Positive", "إيجابي"),
    NEGATIVE: tr("Negative", "سلبي"),
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
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => {
      const key = field.componentId || "__TEST__";
      const currentIsActive = Boolean(field.currentOptionId && field.qualitativeOptions.some(option => option.id === field.currentOptionId));
      return [key, currentIsActive ? field.currentOptionId! : field.currentValue && field.qualitativeOptions.length > 0 ? "__LEGACY__" : ""];
    })),
  );
  const [componentComments, setComponentComments] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.componentId || "__TEST__", field.currentComment || ""])),
  );
  const [note, setNote] = useState(comments);
  const [savedResultId, setSavedResultId] = useState(resultId);
  const [savedStatus, setSavedStatus] = useState(resultStatus);
  const [complete, setComplete] = useState(Boolean(resultId && resultStatus === "ENTERED"));
  const [busy, setBusy] = useState<"save" | "verify" | "">("");
  const [message, setMessage] = useState("");

  function handleEntryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!shouldAdvanceResultEntryOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    })) return;

    if (focusNextResultEntryControl(event.currentTarget)) event.preventDefault();
  }

  function fieldInput(field: ResultField) {
    const key = field.componentId || "__TEST__";
    if (field.calculated) return <div className="calculated-value-box"><strong>{values[key] || tr("Calculated on save", "يُحسب عند الحفظ")}</strong><small>{tr("Derived from configured formula", "مشتق من معادلة مهيأة")}</small></div>;

    const common = {
      value: values[key] || "",
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };

    if (field.resultType === "QUALITATIVE" && field.qualitativeOptions.length > 0) {
      const selected = selectedOptions[key] || "";
      return <select
        data-result-entry-control="true"
        value={selected}
        onChange={(event) => {
          const optionId = event.target.value;
          setSelectedOptions((current) => ({ ...current, [key]: optionId }));
          const option = field.qualitativeOptions.find((item) => item.id === optionId);
          setValues((current) => ({ ...current, [key]: option?.valueEn || "" }));
        }}
      >
        <option value="">{tr("Select result…", "اختر النتيجة…")}</option>
        {selected === "__LEGACY__" && field.currentValue && <option value="__LEGACY__" disabled>{tr("Current legacy value", "القيمة القديمة الحالية")}: {field.currentValue}</option>}
        {field.qualitativeOptions.map((option) => <option key={option.id} value={option.id}>
          {(locale === "ar" ? option.valueAr || option.valueEn : option.valueEn) + " · " + flagLabel(option.flag) + (option.isAbnormal ? " · " + tr("Abnormal", "غير طبيعي") : "") + (option.isCritical ? " · " + tr("Critical", "حرجة") : "")}
        </option>)}
      </select>;
    }

    if (field.resultType === "BOOLEAN") {
      return <select data-result-entry-control="true" {...common}>
        <option value="">—</option>
        <option value="true">{tr("True", "نعم")}</option>
        <option value="false">{tr("False", "لا")}</option>
      </select>;
    }
    if (field.resultType === "DATE") return <input data-result-entry-control="true" type="date" onKeyDown={handleEntryKeyDown} {...common} />;
    if (field.resultType === "NUMERIC") return <input data-result-entry-control="true" inputMode="decimal" onKeyDown={handleEntryKeyDown} placeholder={tr("Numeric result", "نتيجة رقمية")} {...common} />;
    if (field.resultType === "TEXT") return <textarea data-result-entry-control="true" rows={2} placeholder={tr("Result text", "نص النتيجة")} {...common} />;
    return <input data-result-entry-control="true" onKeyDown={handleEntryKeyDown} placeholder={tr("Qualitative result", "نتيجة وصفية")} {...common} />;
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
        values: fields.map((field) => {
          const key = field.componentId || "__TEST__";
          const selectedOptionId = selectedOptions[key];
          return {
            componentId: field.componentId,
            rawValue: values[key] || "",
            resultOptionId: selectedOptionId && selectedOptionId !== "__LEGACY__" ? selectedOptionId : null,
            ...(field.componentId ? { comments: componentComments[key] || "" } : {}),
          };
        }),
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
  const resultLevelTemplates = commentTemplates.filter((template) => commentTemplateTargetMatches(template, testId, null));
  const activeSectionIds = new Set(resultSections.map(section => section.id));
  const fieldGroups = [
    ...resultSections.map(section => ({
      ...section,
      fields: fields.filter(field => field.resultSectionId === section.id),
    })).filter(group => group.fields.length > 0),
    {
      id: null,
      code: "",
      nameEn: "Other / Ungrouped",
      nameAr: "أخرى / بدون قسم",
      fields: fields.filter(field => !field.resultSectionId || !activeSectionIds.has(field.resultSectionId)),
    },
  ].filter(group => group.fields.length > 0);

  function renderFieldRow(field: ResultField) {
    const key = field.componentId || "__TEST__";
    return <div className={`result-field-row ${field.critical ? "result-critical" : ""}`} key={key}>
      <div className="result-field-name">
        <strong>{field.code} — {locale === "ar" ? field.nameAr || field.nameEn : field.nameEn}</strong>
        {locale !== "ar" && field.nameAr && <small dir="rtl">{field.nameAr}</small>}
        <small>{resultTypeLabel(field.resultType)}{field.unit ? ` · ${field.unit}` : ""}</small>
      </div>
      <div className="result-field-input">
        {locked ? <strong>{values[key] || "—"}</strong> : fieldInput(field)}
        {field.componentId && <div className="component-comment-editor">
          {!locked && commentTemplates.some((template) => commentTemplateTargetMatches(template, testId, field.componentId)) && <select
            defaultValue=""
            onChange={(event) => {
              const template = commentTemplates.find((item) => item.id === event.target.value && commentTemplateTargetMatches(item, testId, field.componentId));
              if (template) {
                const templateText = locale === "ar" ? template.textAr || template.textEn : template.textEn;
                setComponentComments((current) => ({
                  ...current,
                  [key]: current[key] ? current[key] + "\n" + templateText : templateText,
                }));
              }
              event.target.value = "";
            }}
          >
            <option value="">{tr("Insert component comment…", "إدراج تعليق للمكوّن…")}</option>
            {commentTemplates
              .filter((template) => commentTemplateTargetMatches(template, testId, field.componentId))
              .map((template) => <option key={template.id} value={template.id}>
                {template.code} — {locale === "ar" ? template.nameAr || template.nameEn : template.nameEn}
              </option>)}
          </select>}
          <textarea
            data-result-entry-control="true"
            rows={2}
            value={componentComments[key] || ""}
            onChange={(event) => setComponentComments((current) => ({ ...current, [key]: event.target.value }))}
            disabled={locked}
            placeholder={tr("Component comment", "تعليق المكوّن")}
          />
        </div>}
      </div>
      <div className="result-field-reference">
        <span>{field.referenceDisplay || tr("No active reference interval", "لا يوجد مدى مرجعي نشط")}</span>
        {field.currentFlag && <strong>{flagLabel(field.currentFlag)}</strong>}
        {field.deltaEvaluation && field.deltaEvaluation !== "NOT_CONFIGURED" && <span className={field.deltaEvaluation === "EXCEEDED" ? "delta-exceeded" : "delta-ok"}>
          {tr("Delta", "دلتا")}: {field.deltaDisplay || deltaLabel(field.deltaEvaluation)}
        </span>}
      </div>
    </div>;
  }

  return <form className="result-entry-form" onSubmit={save}>
    <div className="result-entry-header">
      <div><strong>{tr("Status", "الحالة")}</strong><span>{savedStatus ? sharedStatusLabel(locale, savedStatus) : tr("Not entered", "غير مدخل")}</span></div>
      <div><strong>{tr("Source", "المصدر")}</strong><span>{sourceLabel(resultSource)}{analyzerLabel ? ` · ${analyzerLabel}` : ""}</span></div>
    </div>

    {resultEntryLayout === "STANDARD" ? <div className="result-field-list">
      {fields.map(renderFieldRow)}
    </div> : <div className={`result-entry-layout result-entry-layout-${resultEntryLayout.toLowerCase().replaceAll("_", "-")}`}>
      {fieldGroups.map(group => <section className="result-entry-section" key={group.id || "__UNGROUPED__"}>
        <div className="result-entry-section-head">
          <div>
            <strong>{group.id ? (locale === "ar" ? group.nameAr || group.nameEn : group.nameEn) : tr("Other / Ungrouped", "أخرى / بدون قسم")}</strong>
            {group.id && <small>{group.code}</small>}
          </div>
          <span>{group.fields.length} {tr("component(s)", "مكوّن")}</span>
        </div>
        <div className="result-field-list">{group.fields.map(renderFieldRow)}</div>
      </section>)}
    </div>}

    <label className="result-comments">{tr("Comments", "التعليقات")}
      {!locked && resultLevelTemplates.length > 0 && <select
        defaultValue=""
        onChange={(event) => {
          const template = resultLevelTemplates.find((item) => item.id === event.target.value);
          if (template) {
            const templateText = locale === "ar" ? template.textAr || template.textEn : template.textEn;
            setNote((current) => current ? current + "\n" + templateText : templateText);
          }
          event.target.value = "";
        }}
      >
        <option value="">{tr("Insert comment template…", "إدراج قالب تعليق…")}</option>
        {resultLevelTemplates.map((template) => <option key={template.id} value={template.id}>
          {template.code} — {locale === "ar" ? template.nameAr || template.nameEn : template.nameEn}
        </option>)}
      </select>}
      <textarea data-result-entry-control="true" rows={3} value={note} onChange={(event) => setNote(event.target.value)} disabled={locked} />
    </label>

    {message && <div className="form-success">{message}</div>}

    <div className="result-actions">
      {!locked && <button className="primary-button" data-result-entry-control="true" disabled={busy !== ""}>{busy === "save" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Result", "حفظ النتيجة")}</button>}
      {!statusLocked && canVerify && savedResultId && complete && <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>{busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Result", "التحقق من النتيجة")}</button>}
      {statusLocked && <span className="muted">{tr("Verified/released results are locked. Future edits must use an amendment workflow.", "النتائج التي تم التحقق منها أو إصدارها مقفلة، وأي تعديل لاحق يجب أن يتم عبر مسار التعديل الرسمي.")}</span>}
      {!statusLocked && sourceLocked && <span className="muted">{tr("Analyzer/import-origin values are read-only here. Use the analyzer integration workflow for additional observations or corrections.", "القيم الواردة من الجهاز أو الاستيراد للقراءة فقط هنا. استخدم مسار تكامل أجهزة التحليل لإضافة مشاهدات أو تصحيحات.")}</span>}
    </div>
  </form>;
}
