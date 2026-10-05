"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevalidateImportButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/revalidate`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const s = body.summary || {};
      setMessage(`Revalidated: ${s.VALID || 0} valid, ${s.WARNING || 0} warnings, ${s.ERROR || 0} errors.`);
      router.refresh();
    } else {
      setMessage(body.error || "Revalidation failed.");
    }
    setBusy(false);
  }

  return <div className="safe-import-action">
    <button className="secondary-button" disabled={busy} onClick={run}>{busy ? "Revalidating…" : "Revalidate Batch"}</button>
    {message && <span>{message}</span>}
  </div>;
}
