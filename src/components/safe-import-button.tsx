"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function SafeImportButton({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !open) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as {
        imported?: number; skipped?: number; deferred?: number; error?: string;
      };
      if (!response.ok) {
        setFormError(body.error || tr("Import failed.", "فشل الاستيراد."));
        return;
      }
      setOpen(false);
      setMessage(tr(
        `Imported ${body.imported} records, skipped ${body.skipped}, deferred ${body.deferred} reference intervals.`,
        `تم استيراد ${body.imported} سجل، وتجاوز ${body.skipped}، وتأجيل ${body.deferred} مدى مرجعي.`,
      ));
      router.refresh();
    } catch {
      setFormError(tr(
        "Connection interrupted. Check the import-batch ledger before retrying.",
        "انقطع الاتصال؛ تحقق من سجل دفعات الاستيراد قبل إعادة المحاولة.",
      ));
    } finally {
      setBusy(false);
    }
  }

  return <div className="safe-import-action">
    <button className="primary-button" type="button" disabled={busy}
      onClick={() => { setMessage(""); setFormError(""); setOpen(true); }}>
      {busy ? tr("Importing…", "جارٍ الاستيراد…") :
        tr("Import Safe Master Data", "استيراد البيانات الأساسية الآمنة")}
    </button>
    {message && <span role="status">{message}</span>}
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Review Governed Master Data Import", "مراجعة استيراد البيانات المرجعية المحكوم")}
      description={tr(
        "Only previously validated tests, units, containers and panels may be activated. WARNING/duplicate/generated-code rows remain excluded; existing records are never overwritten. Reference intervals are deferred for separate clinical review.",
        "لا تُفعّل إلا الفحوص والوحدات والحاويات والباقات التي اجتازت التحقق؛ تُستبعد صفوف التحذير والأكواد المكررة أو المولّدة، ولا تُستبدل السجلات القائمة. تؤجّل المديات المرجعية لاعتماد سريري مستقل.",
      )}>
      {open && <form className="catalog-form" onSubmit={commit}>
        <p className="form-span">{tr(
          "Confirm import of eligible reviewed master data from the selected batch?",
          "تأكيد استيراد البيانات المرجعية الصالحة بعد مراجعتها من الدفعة المحددة؟",
        )}</p>
        <p className="muted form-span">{tr(
          "Historical clinical data and approved effective-dated intervals must remain unchanged.",
          "يجب أن تبقى البيانات السريرية التاريخية والمديات المرجعية المعتمدة ذات تواريخ السريان دون تغيير.",
        )}</p>
        {formError && <p role="alert" className="form-error form-span">{formError}</p>}
        <button className="primary-button form-span" type="submit" disabled={busy}>
          {busy ? tr("Importing…", "جارٍ الاستيراد…") :
            tr("Confirm safe import", "تأكيد الاستيراد الآمن")}
        </button>
      </form>}
    </CrudModal>
  </div>;
}
