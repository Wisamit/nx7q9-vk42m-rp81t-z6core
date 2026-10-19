"use client";

import { useRef, useState } from "react";
import { validateReviewStageReceipt } from "@/lib/catalog-review-stage-receipt";
import { ReviewFileUploadDialog } from "@/components/review-file-upload-dialog";
import { CatalogStageRecoveryButton } from "@/components/catalog-stage-recovery-button";
import { useRouter } from "next/navigation";

const MAX_BYTES = 4 * 1024 * 1024;

/** Structured JSON export is a *review source*, not an import approval token. */
export function CatalogBundleReviewStaging({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryBlocked, setRetryBlocked] = useState(false);
  const stageAttempted = useRef(false);
  const submissionKey = useRef<string | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  async function stage(file: File): Promise<boolean> {
    if (busy || inFlight.current || stageAttempted.current || retryBlocked) return false;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!file.name.toLowerCase().endsWith(".json") || !file.size || file.size > MAX_BYTES) {
        setMessage(tr("Select a JSON configuration export up to 4 MB.",
          "اختر ملف JSON من تصدير الإعدادات بحجم لا يتجاوز 4 ميغابايت."));
        return false;
      }
      // Once a POST is attempted, a lost response is ambiguous; each
      // success creates a fresh private draft. Never blindly re-submit.
      submissionKey.current ??= crypto.randomUUID();
      setSubmittedKey(submissionKey.current);
      stageAttempted.current = true;
      setRetryBlocked(true);
      const result = await fetch("/api/catalog/imports/bundle?sourceName=" +
        encodeURIComponent(file.name), {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json",
            "x-family-lab-staging-key": submissionKey.current },
          body: file, cache: "no-store",
        });
      const body: unknown = await result.json().catch(() => null);
      const receipt = result.ok ? validateReviewStageReceipt(body, "BUNDLE") : null;
      if (!receipt || !body || typeof body !== "object" ||
          !("reviewOnly" in body) || body.reviewOnly !== true) {
        const reason = body && typeof body === "object" && !Array.isArray(body) &&
          "error" in body && typeof body.error === "string" ? body.error : "";
        setMessage(tr(
          "Bundle review result unconfirmed. A DRAFT may already exist. Inspect your private batch ledger and audit, then reload before any retry.",
          "نتيجة مراجعة الحزمة غير مؤكدة. قد تكون المسودة موجودة بالفعل. راجع الدفعات الخاصة وسجل التدقيق ثم أعد تحميل الصفحة قبل المحاولة مجدداً.",
        ) + (reason ? " (" + reason + ")" : ""));
        return false;
      }
      router.push("/catalog/imports/" + encodeURIComponent(receipt.id));
      router.refresh();
      return true;
    } catch {
      setMessage(stageAttempted.current ? tr(
        "Connection interrupted after bundle submission. The review draft may exist already. Check your private import ledger and audit before re-upload.",
        "انقطع الاتصال بعد إرسال الحزمة؛ ربما مسودة المراجعة موجودة بالفعل. افحص سجل الاستيراد الخاص والتدقيق قبل إعادة الرفع.",
      ) : tr("Could not prepare local bundle; no request was submitted.",
        "تعذر إعداد الحزمة محلياً ولم يُرسل طلب."));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Review a previously exported catalog JSON bundle", "مراجعة ملف JSON مُصدَّر من إعدادات المختبر")}</h2>
    <p className="muted">{tr(
      "Upload the native ten-class JSON bundle downloaded above, including complete panels, commercial packages and package tariffs. Source identifiers, branch/department access, permissions and original decimal values are checked. All rows stay DRAFT / review-only: this does not restore, activate or overwrite any clinical or financial configuration.",
      "ارفع ملف JSON الأصلي بتسع فئات، بما فيها عضويات الفحوص والباقات وأسعار الباقات. يتم التحقق من هوية المصدر وصلاحيات الفروع والأقسام والأسعار والقيم العشرية الأصلية. تبقى جميع الصفوف مسودة للمراجعة فقط، ولا يتم تفعيل أو استعادة أو تعديل أي إعداد سريري أو مالي.",
    )}</p>
    <div className="review-actions">
      <ReviewFileUploadDialog locale={locale} busy={busy} retryBlocked={retryBlocked} error={message}
        onResetError={() => setMessage("")}
        title={tr("Review signed catalog JSON bundle", "مراجعة حزمة إعدادات المختبر")}
        description={tr("Select a previously exported JSON bundle and confirm draft-only review.", "اختر حزمة JSON مُصدَّرة سابقاً وأكد تجهيزها للمراجعة فقط.")}
        triggerLabel={tr("Stage JSON bundle for review", "تجهيز ملف JSON للمراجعة")}
        accept=".json,application/json"
        fileHint={tr("JSON only, maximum 4 MB. This action never activates imported clinical or financial settings.", "ملف JSON فقط بحد أقصى 4 ميغابايت. لا يفعّل هذا الإجراء أي إعداد سريري أو مالي.")}
        onStage={stage} />
    </div>
    {message && <p role="alert">{message}</p>}
    {retryBlocked && <CatalogStageRecoveryButton locale={locale} sourceType="CONFIG_BUNDLE_REVIEW" submissionKey={submittedKey} />}
    {retryBlocked && <p className="form-warning" role="status">{tr(
      "Check existing private configuration review batches and audit before another upload; reload after review.",
      "راجع دفعات مراجعة الإعدادات الخاصة وسجل التدقيق قبل أي رفع جديد، ثم أعد تحميل الصفحة.",
    )}</p>}
  </section>;
}
