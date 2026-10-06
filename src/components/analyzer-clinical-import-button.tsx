"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzerClinicalImportButton({
  importIds,
  locale,
}: {
  importIds: string[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function commit() {
    if (!confirm(tr(`Import ${importIds.length} mapped analyzer observation(s) into the clinical result? This does not verify or release the result.`, `هل تريد استيراد ${importIds.length} من مشاهدات الجهاز المربوطة إلى النتيجة السريرية؟ هذا لا يتحقق من النتيجة ولا يصدرها.`))) return;

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
        ? tr("Analyzer observations imported. Result is complete and ready for validation.", "تم استيراد مشاهدات الجهاز. النتيجة مكتملة وجاهزة للتحقق.")
        : tr("Analyzer observations imported. Result remains draft until all required components arrive.", "تم استيراد مشاهدات الجهاز. تبقى النتيجة مسودة حتى وصول جميع المكونات المطلوبة."));
      router.refresh();
    } else {
      setMessage(tr("Analyzer observations could not be imported.", "تعذر استيراد مشاهدات الجهاز."));
    }
  }

  return <div>
    <button className="primary-button" type="button" disabled={busy} onClick={() => void commit()}>
      {busy ? tr("Importing…","جارٍ الاستيراد…") : tr(`Import ${importIds.length} observation(s)`, `استيراد ${importIds.length} مشاهدة`)}
    </button>
    {message && <small className="muted">{message}</small>}
  </div>;
}
