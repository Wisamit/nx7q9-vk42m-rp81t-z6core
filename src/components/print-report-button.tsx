"use client";

import { useState } from "react";

export function PrintReportButton({
  reportVersionId,
  canRecordDelivery,
  locale,
}: {
  reportVersionId: string;
  canRecordDelivery: boolean;
  locale: "ar" | "en";
}) {
  const [busy, setBusy] = useState(false);
  const [printError, setPrintError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function printReport() {
    if (busy) return;
    setPrintError("");
    if (canRecordDelivery) {
      setBusy(true);
      const response = await fetch(`/api/reports/${reportVersionId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "PRINT", status: "RECORDED" }),
      }).catch(() => null);
      setBusy(false);
      if (!response?.ok) {
        setPrintError(tr(
          "Printing was blocked because the delivery event could not be audit-logged.",
          "تم منع الطباعة بسبب تعذر تسجيل حدث التسليم في سجل التدقيق.",
        ));
        return;
      }
    }
    window.print();
  }

  return <div className="no-print">
    <button className="primary-button" type="button" disabled={busy}
      onClick={() => void printReport()}>
      {busy ? tr("Preparing…", "جارٍ التحضير…") : tr("Print Report", "طباعة التقرير")}
    </button>
    {printError && <p className="form-error" role="alert">{printError}</p>}
  </div>;
}
