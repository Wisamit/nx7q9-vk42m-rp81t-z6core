"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Preview = { total: number; safe: number; review: number; reasons: Record<string, number> };

export function ReferenceRangeImportButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setPreview(data))
      .catch(() => setPreview(null));
  }, [batchId]);

  async function run() {
    if (!preview?.safe) return;
    if (!confirm(`Import ${preview.safe} reference intervals with exact test/unit/context mapping as INACTIVE records pending clinical approval? ${preview.review} rows will remain for manual review.`)) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Imported ${body.imported} inactive reference intervals pending clinical approval; ${body.review} remain for mapping review.`);
      setPreview({ total: body.total, safe: 0, review: body.review, reasons: body.reasons || {} });
      router.refresh();
    } else {
      setMessage(body.error || "Reference range import failed.");
    }
    setBusy(false);
  }

  if (!preview) return <span className="muted">Analyzing reference ranges…</span>;

  return <div className="range-import-panel">
    <div className="range-import-summary">
      <strong>Reference ranges:</strong>
      <span>{preview.total} staged</span>
      <span>{preview.safe} safe</span>
      <span>{preview.review} review</span>
    </div>
    {preview.safe > 0 && <button className="primary-button" disabled={busy} onClick={run}>{busy ? "Importing ranges…" : "Import Safe Reference Ranges"}</button>}
    {message && <span className="range-import-message">{message}</span>}
    {preview.review > 0 && Object.keys(preview.reasons || {}).length > 0 && <div className="range-review-reasons">
      <strong>Review reasons</strong>
      {Object.entries(preview.reasons).sort((a,b) => b[1]-a[1]).map(([reason,count]) => <div key={reason}><span>{reason}</span><strong>{count}</strong></div>)}
    </div>}
  </div>;
}
