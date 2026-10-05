"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzerClinicalImportButton({
  importIds,
}: {
  importIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function commit() {
    if (!confirm(`Import ${importIds.length} mapped analyzer observation(s) into the clinical result? This does not verify or release the result.`)) return;

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/analyzers/imports/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importIds }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (response.ok) {
      setMessage(body.complete
        ? "Analyzer observations imported. Result is complete and ready for validation."
        : "Analyzer observations imported. Result remains draft until all required components arrive.");
      router.refresh();
    } else {
      setMessage(body.error || "Analyzer observations could not be imported.");
    }
  }

  return <div>
    <button className="primary-button" type="button" disabled={busy} onClick={() => void commit()}>
      {busy ? "Importing…" : `Import ${importIds.length} observation(s)`}
    </button>
    {message && <small className="muted">{message}</small>}
  </div>;
}
