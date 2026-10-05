"use client";

import { useState } from "react";

export function PrintReportButton({ reportVersionId, canRecordDelivery }: { reportVersionId: string; canRecordDelivery: boolean }) {
  const [busy, setBusy] = useState(false);

  async function printReport() {
    if (canRecordDelivery) {
      setBusy(true);
      await fetch(`/api/reports/${reportVersionId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "PRINT", status: "RECORDED" }),
      }).catch(() => null);
      setBusy(false);
    }
    window.print();
  }

  return <button className="primary-button no-print" type="button" disabled={busy} onClick={() => void printReport()}>
    {busy ? "Preparing…" : "Print Report"}
  </button>;
}
