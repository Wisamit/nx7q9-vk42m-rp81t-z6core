"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BulkField = {
  componentId: string | null;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
  currentValue: string;
};

type BulkRow = {
  orderItemId: string;
  accessionNumber: string;
  patientNumber: string;
  patientName: string;
  testCode: string;
  testName: string;
  specimenId: string;
  barcode: string;
  performingBranchId: string;
  fields: BulkField[];
  comments: string;
};

function inputFor(
  field: BulkField,
  value: string,
  onChange: (value: string) => void,
  locale: "ar" | "en",
) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  if (field.resultType === "BOOLEAN") return <select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">—</option><option value="true">{tr("True","نعم")}</option><option value="false">{tr("False","لا")}</option>
  </select>;
  if (field.resultType === "DATE") return <input type="date" value={value} onChange={event => onChange(event.target.value)} />;
  if (field.resultType === "NUMERIC") return <input inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} placeholder={tr("Value","القيمة")} />;
  return <input value={value} onChange={event => onChange(event.target.value)} placeholder={field.resultType === "TEXT" ? tr("Text result","نتيجة نصية") : tr("Result","النتيجة")} />;
}

export function BulkResultEntry({ rows, locale }: { rows: BulkRow[]; locale: "ar" | "en" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialValues = useMemo(() => Object.fromEntries(rows.map(row => [
    row.orderItemId,
    Object.fromEntries(row.fields.map(field => [field.componentId || "__TEST__", field.currentValue])),
  ])), [rows]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>(initialValues);
  const [comments, setComments] = useState<Record<string, string>>(Object.fromEntries(rows.map(row => [row.orderItemId, row.comments])));
  const [states, setStates] = useState<Record<string, { status: "idle" | "saving" | "ok" | "error"; message?: string }>>({});
  const [busy, setBusy] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  const enteredCount = rows.filter(row =>
    row.fields.some(field => (values[row.orderItemId]?.[field.componentId || "__TEST__"] || "").trim() !== "")
    || (comments[row.orderItemId] || "").trim() !== ""
  ).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enteredCount === 0) return;
    setBusy(true);
    let successful = 0;

    for (const row of rows) {
      const rowValues = values[row.orderItemId] || {};
      const hasInput = row.fields.some(field => (rowValues[field.componentId || "__TEST__"] || "").trim() !== "")
        || (comments[row.orderItemId] || "").trim() !== "";
      if (!hasInput) continue;

      setStates(current => ({ ...current, [row.orderItemId]: { status: "saving" } }));
      const response = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderItemId: row.orderItemId,
          specimenId: row.specimenId,
          performingBranchId: row.performingBranchId,
          comments: comments[row.orderItemId] || "",
          values: row.fields.map(field => ({
            componentId: field.componentId,
            rawValue: rowValues[field.componentId || "__TEST__"] || "",
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        successful++;
        const notices = [
          body.criticalCount ? body.criticalCount + " " + tr("critical","حرجة") : "",
          body.deltaExceededCount ? body.deltaExceededCount + " " + tr("delta","تغير دلتا") : "",
          body.blockingValidationHoldCount ? body.blockingValidationHoldCount + " " + tr("hold","حجز تحقق") : "",
        ].filter(Boolean);
        setStates(current => ({
          ...current,
          [row.orderItemId]: {
            status: "ok",
            message: body.autoVerified ? tr("Saved · autoverified","تم الحفظ · تحقق تلقائي") : notices.length ? tr("Saved","تم الحفظ") + " · " + notices.join(" · ") : body.complete ? tr("Saved · ready for verification","تم الحفظ · جاهز للتحقق") : tr("Draft saved","تم حفظ المسودة"),
          },
        }));
      } else {
        setStates(current => ({
          ...current,
          [row.orderItemId]: { status: "error", message: tr("Save failed","فشل الحفظ") },
        }));
      }
    }

    setBusy(false);
    if (successful > 0) router.refresh();
  }

  if (rows.length === 0) return null;

  return <section className="bulk-entry-panel detail-section">
    <div className="bulk-entry-head">
      <div><p className="eyebrow">{tr("Keyboard-oriented workflow","مسار عمل مهيأ للوحة المفاتيح")}</p><h2>{tr("Bulk Result Entry","إدخال النتائج بالجملة")}</h2><p className="muted">{tr("Each row is saved through the same reference-range, critical, delta, reflex, hold and autoverification rules as individual entry.","يُحفظ كل صف عبر نفس قواعد المديات المرجعية والنتائج الحرجة والدلتا والفحوص الانعكاسية وحجوزات التحقق والتحقق التلقائي المستخدمة في الإدخال الفردي.")}</p></div>
      <button type="button" className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? tr("Close Bulk Entry","إغلاق الإدخال الجماعي") : tr("Open Bulk Entry","فتح الإدخال الجماعي")}</button>
    </div>
    {open && <form onSubmit={submit}>
      <div className="bulk-result-list">
        {rows.map(row => {
          const state = states[row.orderItemId] || { status: "idle" as const };
          return <article className={"bulk-result-row bulk-" + state.status} key={row.orderItemId}>
            <div className="bulk-result-context">
              <strong>{row.testCode} — {row.testName}</strong>
              <span>{row.accessionNumber} · {row.patientNumber} · {row.patientName}</span>
              <small className="barcode-text">{row.barcode}</small>
            </div>
            <div className="bulk-result-fields">
              {row.fields.map(field => {
                const key = field.componentId || "__TEST__";
                return <label key={key}><span>{field.code}</span>{inputFor(field, values[row.orderItemId]?.[key] || "", value => setValues(current => ({
                  ...current,
                  [row.orderItemId]: { ...(current[row.orderItemId] || {}), [key]: value },
                }))), locale)}</label>;
              })}
              <label className="bulk-comment"><span>{tr("Comment","تعليق")}</span><input value={comments[row.orderItemId] || ""} onChange={event => setComments(current => ({ ...current, [row.orderItemId]: event.target.value }))} /></label>
            </div>
            <div className="bulk-row-state">
              {state.status === "saving" ? tr("Saving…","جارٍ الحفظ…") : state.message || tr("Ready","جاهز")}
            </div>
          </article>;
        })}
      </div>
      <div className="bulk-actions">
        <span>{enteredCount} {tr("row(s) with entered data","صف يحتوي بيانات مدخلة")}</span>
        <button className="primary-button" disabled={busy || enteredCount === 0}>{busy ? tr("Saving batch…","جارٍ حفظ الدفعة…") : tr("Save Entered Results","حفظ النتائج المدخلة")}</button>
      </div>
    </form>}
  </section>;
}
