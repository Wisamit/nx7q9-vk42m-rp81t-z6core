"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 4 * 1024 * 1024;

/** Structured JSON export is a *review source*, not an import approval token. */
export function CatalogBundleReviewStaging({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  async function stage(file: File) {
    if (busy) return;
    if (!file.name.toLowerCase().endsWith(".json") || !file.size || file.size > MAX_BYTES) {
      setMessage(tr("Select a JSON configuration export up to 4 MB.",
        "اختر ملف JSON من تصدير الإعدادات بحجم لا يتجاوز 4 ميغابايت."));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/catalog/imports/bundle?sourceName=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: file, cache: "no-store",
      });
      const body = await result.json() as { id?: string; error?: string; reviewOnly?: boolean };
      if (!result.ok || !body.id || body.reviewOnly !== true) {
        throw new Error(body.error || "bundle_review_staging_failed");
      }
      router.push("/catalog/imports/" + encodeURIComponent(body.id));
      router.refresh();
    } catch (error) {
      setMessage(tr("Configuration review failed: ", "تعذر تجهيز مراجعة الإعدادات: ") +
        (error instanceof Error ? error.message : "bundle_review_staging_failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Review a previously exported catalog JSON bundle", "مراجعة ملف JSON مُصدَّر من إعدادات المختبر")}</h2>
    <p className="muted">{tr(
      "Upload the native six-class JSON bundle downloaded above. Source identifiers, branch/department access, permissions and original decimal values are checked. All rows stay DRAFT / review-only: this does not restore, activate or overwrite any clinical or financial configuration.",
      "ارفع ملف JSON الأصلي الذي تم تصديره من الأعلى. يتم التحقق من هوية المصدر وصلاحيات الفروع والأقسام والأسعار والقيم العشرية الأصلية. تبقى جميع الصفوف مسودة للمراجعة فقط، ولا يتم تفعيل أو استعادة أو تعديل أي إعداد سريري أو مالي.",
    )}</p>
    <input ref={input} type="file" hidden accept=".json,application/json"
      onChange={event => { const file = event.target.files?.[0]; if (file) void stage(file); }} />
    <div className="review-actions">
      <button type="button" disabled={busy} className="secondary-button" onClick={() => input.current?.click()}>
        {busy ? tr("Reviewing…", "جارٍ تجهيز المراجعة…") : tr("Stage JSON bundle for review", "تجهيز ملف JSON للمراجعة")}
      </button>
    </div>
    {message && <p role="alert">{message}</p>}
  </section>;
}
