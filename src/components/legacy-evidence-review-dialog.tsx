"use client";

import { useId, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";

type Props = {
  locale: "ar" | "en";
  triggerLabel: string;
  title: string;
  description: string;
  fileHint: string;
  maxBytes: number;
  busy: boolean;
  error?: string;
  sourceTables?: readonly string[];
  onReview: (file: File, selectedTable: string) => Promise<boolean>;
  onResetError: () => void;
};

/**
 * Evidence selection is LOCAL until explicit review. This does not imply
 * approved source provenance, test mapping, clinical intervals or data import.
 */
export function LegacyEvidenceReviewDialog({
  locale, triggerLabel, title, description, fileHint, maxBytes, busy, error,
  sourceTables, onReview, onResetError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectedTable, setSelectedTable] = useState("");
  const [localError, setLocalError] = useState("");
  const submitting = useRef(false);
  const fileId = useId();
  const tableId = useId();
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  function reset() {
    setFile(null);
    setSelectedTable("");
    setLocalError("");
  }
  function close() {
    if (busy || submitting.current) return;
    setOpen(false);
    reset();
  }
  async function submitEvidence() {
    if (busy || submitting.current || !file || (sourceTables && !selectedTable)) return;
    if (!file.name.toLowerCase().endsWith(".json") || file.size === 0 || file.size > maxBytes) {
      setLocalError(tr(
        "Select a non-empty JSON evidence file within the stated size limit.",
        "اختر ملف أدلة JSON غير فارغ ضمن الحجم المسموح.",
      ));
      return;
    }
    submitting.current = true;
    setLocalError("");
    try {
      const ok = await onReview(file, selectedTable);
      if (ok) {
        setOpen(false);
        reset();
      }
    } catch {
      setLocalError(tr(
        "Evidence review was interrupted. Check the review audit before submitting again.",
        "انقطعت مراجعة الأدلة. تحقق من سجل المراجعة قبل إعادة الإرسال.",
      ));
    } finally {
      submitting.current = false;
    }
  }

  return <>
    <button type="button" className="secondary-button" disabled={busy}
      onClick={() => { reset(); onResetError(); setOpen(true); }}>
      {busy ? tr("Reviewing evidence…", "جارٍ مراجعة الأدلة…") : triggerLabel}
    </button>
    <CrudModal open={open} onClose={close} size="compact" protectUnsavedChanges
      title={title} description={description}>
      {open && <div className="form-stack">
        {sourceTables && <>
          <label htmlFor={tableId}>{tr(
            "Choose one Access reference table for structural comparison",
            "اختر جدول مديات واحداً من Access للمقارنة البنيوية",
          )}</label>
          <select id={tableId} value={selectedTable} disabled={busy}
            onChange={event => { setSelectedTable(event.target.value); onResetError(); setLocalError(""); }}>
            <option value="">{tr(
              "Select source table — not an approved clinical mapping",
              "اختر جدول المصدر — لا يعني اعتماد الربط السريري",
            )}</option>
            {sourceTables.map(table => <option key={table} value={table}>{table}</option>)}
          </select>
          <p className="muted">{tr(
            "This choice limits evidence comparison only; it does not associate an Access table with a laboratory test.",
            "يحدد الاختيار نطاق مقارنة الأدلة فقط؛ ولا يربط جدول Access بفحص مخبري.",
          )}</p>
        </>}
        <label htmlFor={fileId}>{tr("Local JSON evidence", "ملف الأدلة JSON المحلي")}</label>
        <input id={fileId} type="file" accept=".json,application/json" disabled={busy}
          onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); onResetError(); setLocalError(""); }} />
        <p className="muted">{fileHint}</p>
        {file && <p className="muted">{tr("Selected file", "الملف المختار")}: {file.name}</p>}
        <p className="muted">{tr(
          "File selection does not upload anything. Only explicit confirmation sends evidence to the review endpoint. No clinical values or configuration are approved or imported.",
          "اختيار الملف لا يرفع أي بيانات. تُرسل الأدلة للمراجعة فقط بعد التأكيد الصريح، دون اعتماد أو استيراد قيم سريرية أو إعدادات.",
        )}</p>
        {(error || localError) && <p role="alert" className="form-error">{error || localError}</p>}
        <div className="crud-modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            {tr("Cancel", "إلغاء")}
          </button>
          <button type="button" className="primary-button"
            disabled={busy || !file || Boolean(sourceTables && !selectedTable)}
            onClick={() => void submitEvidence()}>
            {busy ? tr("Reviewing…", "جارٍ المراجعة…") : tr("Confirm evidence review", "تأكيد مراجعة الأدلة")}
          </button>
        </div>
      </div>}
    </CrudModal>
  </>;
}
