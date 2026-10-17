"use client";

import { useId, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";

type ReviewFileUploadDialogProps = {
  locale: "ar" | "en";
  title: string;
  description: string;
  triggerLabel: string;
  accept: string;
  fileHint: string;
  busy: boolean;
  error?: string;
  onStage: (file: File) => Promise<boolean>;
  onResetError: () => void;
};

/**
 * File staging is a deliberate two-step action: select a local file and
 * confirm. This does not approve or activate a clinical/financial master.
 */
export function ReviewFileUploadDialog({
  locale, title, description, triggerLabel, accept, fileHint, busy, error, onStage, onResetError,
}: ReviewFileUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const submitting = useRef(false);
  const fieldId = useId();
  const ar = locale === "ar";
  function close() {
    if (busy || submitting.current) return;
    setOpen(false);
    setFile(null);
  }
  async function confirm() {
    if (!file || busy || submitting.current) return;
    submitting.current = true;
    setSubmissionError("");
    try {
      const succeeded = await onStage(file);
      if (succeeded) {
        setOpen(false);
        setFile(null);
      }
    } catch {
      setSubmissionError(ar ? "تعذر تجهيز المراجعة. أعد المحاولة." : "Could not stage the review. Try again.");
    } finally {
      submitting.current = false;
    }
  }

  return <>
    <button type="button" className="secondary-button" disabled={busy}
      onClick={() => { setFile(null); setSubmissionError(""); onResetError(); setOpen(true); }}>
      {triggerLabel}
    </button>
    <CrudModal open={open} onClose={close} size="compact"
      protectUnsavedChanges title={title} description={description}>
      <div className="form-stack">
        <label htmlFor={fieldId}>
          {ar ? "اختر ملف المراجعة" : "Choose a review source file"}
        </label>
        <input id={fieldId} type="file" accept={accept} disabled={busy}
          onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setSubmissionError(""); onResetError(); }} />
        <p className="muted">{fileHint}</p>
        <p className="muted">{ar
          ? "التجهيز لا يعتمد الأسعار أو الحدود المرجعية ولا ينشر نتائج سريرية. سيتم مراجعة البيانات أولاً."
          : "Staging does not approve prices or reference intervals or release clinical results. All source data must be reviewed."}</p>
        {(error || submissionError) && <p role="alert" className="form-error">{error || submissionError}</p>}
        <div className="crud-modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            {ar ? "إلغاء" : "Cancel"}
          </button>
          <button type="button" className="primary-button"
            disabled={busy || !file} onClick={() => void confirm()}>
            {busy ? (ar ? "جارٍ تجهيز المراجعة…" : "Staging for review…")
              : (ar ? "تأكيد تجهيز الملف" : "Confirm review staging")}
          </button>
        </div>
      </div>
    </CrudModal>
  </>;
}
