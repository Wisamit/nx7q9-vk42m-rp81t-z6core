"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SafeImportButton({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function commit() {
    if (!confirm(tr("Import only VALID tests, units, containers and panels into the live catalog? WARNING rows (including duplicate codes and generated codes) will remain excluded for review. Existing records will not be overwritten. Reference intervals remain deferred for clinical review.", "هل تريد استيراد الفحوصات والوحدات والحاويات والباقات الصالحة فقط إلى الدليل الحي؟ ستبقى صفوف التحذير، بما فيها الأكواد المكررة أو المولدة، مستبعدة للمراجعة. لن يتم استبدال السجلات الحالية، وستبقى المديات المرجعية مؤجلة للمراجعة السريرية."))) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr(`Imported ${body.imported} records, skipped ${body.skipped}, deferred ${body.deferred} reference intervals.`, `تم استيراد ${body.imported} سجل، وتجاوز ${body.skipped}، وتأجيل ${body.deferred} مدى مرجعي.`));
      router.refresh();
    } else {
      setMessage(tr("Import failed.", "فشل الاستيراد."));
    }
    setBusy(false);
  }

  return <div className="safe-import-action">
    <button className="primary-button" disabled={busy} onClick={commit}>{busy ? tr("Importing…","جارٍ الاستيراد…") : tr("Import Safe Master Data","استيراد البيانات الأساسية الآمنة")}</button>
    {message && <span>{message}</span>}
  </div>;
}
