"use client";

import { useState } from "react";

export function SpecimenLabelPrintButton({
  specimenId,
  locale,
  isReprint,
  labelSize,
  disabled,
}: {
  specimenId: string;
  locale: "ar" | "en";
  isReprint: boolean;
  labelSize: "50x30" | "50x25" | "40x25";
  disabled: boolean;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function printLabel() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/specimens/${specimenId}/label-print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, labelSize }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Print event recorded.", "تم تسجيل حدث الطباعة."));
      window.print();
    } else {
      const errors: Record<string, string> = {
        reprint_reason_required: tr("A reprint reason is required.", "سبب إعادة الطباعة مطلوب."),
        specimen_requirements_not_finalized: tr("Finalize specimen requirements before printing a planned label.", "ثبّت متطلبات العينة قبل طباعة ملصق لعينة مخططة."),
        specimen_not_found: tr("Specimen not found.", "العينة غير موجودة."),
        branch_forbidden: tr("This specimen is outside your branch scope.", "هذه العينة خارج نطاق فروعك."),
      };
      setMessage(errors[body.error] || tr("Label print could not be recorded.", "تعذر تسجيل طباعة الملصق."));
    }
    setBusy(false);
  }

  return <div className="specimen-label-controls no-print">
    {isReprint && <label>{tr("Reprint reason", "سبب إعادة الطباعة")}
      <input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required />
    </label>}
    <button type="button" className="primary-button" disabled={disabled || busy || (isReprint && !reason.trim())} onClick={printLabel}>
      {busy ? tr("Preparing…", "جارٍ التحضير…") : isReprint ? tr("Record & Reprint Label", "تسجيل وإعادة طباعة الملصق") : tr("Record & Print Label", "تسجيل وطباعة الملصق")}
    </button>
    {message && <span className="muted">{message}</span>}
  </div>;
}
