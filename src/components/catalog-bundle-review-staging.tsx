"use client";

import { useState } from "react";
import { ReviewFileUploadDialog } from "@/components/review-file-upload-dialog";
import { useRouter } from "next/navigation";

const MAX_BYTES = 4 * 1024 * 1024;

/** Structured JSON export is a *review source*, not an import approval token. */
export function CatalogBundleReviewStaging({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  async function stage(file: File): Promise<boolean> {
    if (busy) return false;
    if (!file.name.toLowerCase().endsWith(".json") || !file.size || file.size > MAX_BYTES) {
      setMessage(tr("Select a JSON configuration export up to 4 MB.",
        "اختر ملف JSON من تصدير الإعدادات بحجم لا يتجاوز 4 ميغابايت."));
      return false;
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
      return true;
    } catch (error) {
      setMessage(tr("Configuration review failed: ", "تعذر تجهيز مراجعة الإعدادات: ") +
        (error instanceof Error ? error.message : "bundle_review_staging_failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Review a previously exported catalog JSON bundle", "مراجعة ملف JSON مُصدَّر من إعدادات المختبر")}</h2>
    <p className="muted">{tr(
      "Upload the native nine-class JSON bundle downloaded above, including complete panels, commercial packages and package tariffs. Source identifiers, branch/department access, permissions and original decimal values are checked. All rows stay DRAFT / review-only: this does not restore, activate or overwrite any clinical or financial configuration.",
      "ارفع ملف JSON الأصلي بتسع فئات، بما فيها عضويات الفحوص والباقات وأسعار الباقات. يتم التحقق من هوية المصدر وصلاحيات الفروع والأقسام والأسعار والقيم العشرية الأصلية. تبقى جميع الصفوف مسودة للمراجعة فقط، ولا يتم تفعيل أو استعادة أو تعديل أي إعداد سريري أو مالي.",
    )}</p>
    <div className="review-actions">
      <ReviewFileUploadDialog locale={locale} busy={busy} error={message}
        title={tr("Review signed catalog JSON bundle", "مراجعة حزمة إعدادات المختبر")}
        description={tr("Select a previously exported JSON bundle and confirm draft-only review.", "اختر حزمة JSON مُصدَّرة سابقاً وأكد تجهيزها للمراجعة فقط.")}
        triggerLabel={tr("Stage JSON bundle for review", "تجهيز ملف JSON للمراجعة")}
        accept=".json,application/json"
        fileHint={tr("JSON only, maximum 4 MB. This action never activates imported clinical or financial settings.", "ملف JSON فقط بحد أقصى 4 ميغابايت. لا يفعّل هذا الإجراء أي إعداد سريري أو مالي.")}
        onStage={stage} />
    </div>
    {message && <p role="alert">{message}</p>}
  </section>;
}
