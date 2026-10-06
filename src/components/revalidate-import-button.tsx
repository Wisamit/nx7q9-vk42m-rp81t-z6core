"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RevalidateImportButton({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function run() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/revalidate`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const s = body.summary || {};
      setMessage(tr(`Revalidated: ${s.VALID || 0} valid, ${s.WARNING || 0} warnings, ${s.ERROR || 0} errors.`, `تمت إعادة التحقق: ${s.VALID || 0} صالح، ${s.WARNING || 0} تحذير، ${s.ERROR || 0} خطأ.`));
      router.refresh();
    } else {
      setMessage(tr("Revalidation failed.", "فشلت إعادة التحقق."));
    }
    setBusy(false);
  }

  return <div className="safe-import-action">
    <button className="secondary-button" disabled={busy} onClick={run}>{busy ? tr("Revalidating…","جارٍ إعادة التحقق…") : tr("Revalidate Batch","إعادة تحقق الدفعة")}</button>
    {message && <span>{message}</span>}
  </div>;
}
