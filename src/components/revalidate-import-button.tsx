"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function RevalidateImportButton({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [retryBlocked, setRetryBlocked] = useState(false);
  const inFlight = useRef(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  function openReview() {
    if (busy || inFlight.current || retryBlocked) return;
    setMessage("");
    setReviewError("");
    setOpen(true);
  }

  async function revalidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open || busy || inFlight.current || retryBlocked) return;
    inFlight.current = true;
    setBusy(true);
    setReviewError("");
    try {
      const response = await fetch(`/api/catalog/imports/${encodeURIComponent(batchId)}/revalidate`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({})) as {
        summary?: Record<string, number>;
        error?: string;
      };
      if (!response.ok) {
        // An HTTP rejection can still follow a server-side mutation, so do
        // not re-submit the same review without refreshing batch evidence.
        setRetryBlocked(true);
        setReviewError(tr(
          "Revalidation was not confirmed. Inspect current batch state and reload this page before trying again.",
          "لم تتأكد إعادة التحقق. افحص حالة الدفعة الحالية وأعد تحميل الصفحة قبل المحاولة مجدداً.",
        ) + (body.error ? " (" + body.error + ")" : ""));
        return;
      }
      const counts = body.summary;
      if (!counts || !["VALID", "WARNING", "ERROR"].every(key =>
        counts[key] === undefined || (Number.isSafeInteger(counts[key]) && counts[key] >= 0))) {
        setRetryBlocked(true);
        setReviewError(tr(
          "Server response was incomplete. Revalidation may have been saved. Reload and inspect the batch before retrying.",
          "استجابة الخادم غير مكتملة؛ ربما حُفظت إعادة التحقق. أعد تحميل الصفحة وتحقق من الدفعة قبل إعادة المحاولة.",
        ));
        return;
      }
      setOpen(false);
      setMessage(tr(
        `Revalidated: ${counts.VALID || 0} valid, ${counts.WARNING || 0} warnings, ${counts.ERROR || 0} errors.`,
        `تمت إعادة التحقق: ${counts.VALID || 0} صالح، ${counts.WARNING || 0} تحذير، ${counts.ERROR || 0} خطأ.`,
      ));
      router.refresh();
    } catch {
      setRetryBlocked(true);
      setReviewError(tr(
        "Connection interrupted after submission. The batch may already be revalidated. Reload and check the audit history before any retry.",
        "انقطع الاتصال بعد الإرسال. قد تكون الدفعة أُعيد التحقق منها بالفعل. أعد تحميل الصفحة وافحص سجل التدقيق قبل أي محاولة جديدة.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <span className="safe-import-action">
    <button type="button" className="secondary-button" disabled={busy || retryBlocked} onClick={openReview}>
      {busy ? tr("Revalidating…", "جارٍ إعادة التحقق…") : tr("Revalidate Batch", "إعادة تحقق الدفعة")}
    </button>
    {message && <small className="form-success" role="status">{message}</small>}
    {retryBlocked && !open && <small role="alert" className="form-warning">{tr(
      "Reload and inspect the batch before revalidating again.",
      "أعد تحميل الصفحة وافحص الدفعة قبل إعادة التحقق مجدداً.",
    )}</small>}
    <CrudModal open={open} onClose={() => { if (!busy && !inFlight.current) setOpen(false); }}
      size="compact"
      title={tr("Review batch revalidation", "مراجعة إعادة تحقق الدفعة")}
      description={tr(
        "This action recalculates the original staged row validation statuses. It does not import tests, approve reference intervals, release clinical results, or overwrite historical records.",
        "يعيد هذا الإجراء حساب حالات التحقق لصفوف الدفعة المرحلية. ولا يستورد فحوصاً أو يعتمد المديات المرجعية أو يصدر نتائج سريرية أو يستبدل سجلات تاريخية.",
      )}>
      {open && <form className="catalog-form" onSubmit={revalidate}>
        <p className="form-span">{tr("Import batch", "دفعة الاستيراد")}: <code>{batchId}</code></p>
        <p className="form-span muted">{tr(
          "Only unprocessed original legacy batches are eligible. Server permission, ownership, branch scope and immutable processed rows are checked again at execution.",
          "يسمح بإعادة التحقق فقط لدفعات النظام القديم الأصلية غير المعالجة. يتحقق الخادم مجدداً من الصلاحيات والملكية والفرع ومنع تعديل الصفوف المعالجة.",
        )}</p>
        {reviewError && <p role="alert" className="form-error form-span">{reviewError}</p>}
        <div className="crud-modal-actions form-span">
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => setOpen(false)}>{tr("Cancel", "إلغاء")}</button>
          <button type="submit" className="primary-button" disabled={busy || retryBlocked}>
            {busy ? tr("Revalidating…", "جارٍ إعادة التحقق…") : tr("Confirm revalidation", "تأكيد إعادة التحقق")}
          </button>
        </div>
      </form>}
    </CrudModal>
  </span>;
}
