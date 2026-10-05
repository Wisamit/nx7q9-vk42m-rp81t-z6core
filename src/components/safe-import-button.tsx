"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SafeImportButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function commit() {
    if (!confirm("Import only VALID tests, units, containers and panels into the live catalog? WARNING rows (including duplicate codes and generated codes) will remain excluded for review. Existing records will not be overwritten. Reference intervals remain deferred for clinical review.")) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Imported ${body.imported} records, skipped ${body.skipped}, deferred ${body.deferred} reference intervals.`);
      router.refresh();
    } else {
      setMessage(body.error || "Import failed.");
    }
    setBusy(false);
  }

  return <div className="safe-import-action">
    <button className="primary-button" disabled={busy} onClick={commit}>{busy ? "Importing…" : "Import Safe Master Data"}</button>
    {message && <span>{message}</span>}
  </div>;
}
