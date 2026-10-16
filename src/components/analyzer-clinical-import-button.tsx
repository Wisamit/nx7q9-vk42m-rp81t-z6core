"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !open || importIds.length === 0) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/analyzers/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importIds }),
      });
      const body = await response.json().catch(() => ({})) as {
        complete?: boolean; error?: string;
      };
      if (!response.ok) {
        setFormError(body.error || tr(
          "Analyzer observations could not be imported.",
          "تعذر استيراد مشاهدات الجهاز.",
        ));
        return;
      }
      setOpen(false);
      setMessage(body.complete
        ? tr(
          "Analyzer observations imported. Result is complete and ready for validation.",
          "تم استيراد مشاهدات الجهاز. النتيجة مكتملة وجاهزة للتحقق.",
        )
        : tr(
          "Analyzer observations imported. Result remains draft until all required components arrive.",
          "تم استيراد مشاهدات الجهاز. تبقى النتيجة مسودة حتى وصول جميع المكونات المطلوبة.",
        ));
      router.refresh();
    } catch {
      setFormError(tr(
        "Connection interrupted; check the clinical import status before retrying.",
        "انقطع الاتصال؛ تحقق من حالة الاستيراد السريري قبل المحاولة مجدداً.",
      ));
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button className="primary-button" type="button"
      disabled={busy || importIds.length === 0}
      onClick={() => { setMessage(""); setFormError(""); setOpen(true); }}>
      {busy ? tr("Importing…", "جارٍ الاستيراد…") :
        tr(`Import ${importIds.length} observation(s)`, `استيراد ${importIds.length} مشاهدة`)}
    </button>
    {message && <small role="status" className="form-success">{message}</small>}
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Review Analyzer Observations Import", "مراجعة استيراد مشاهدات جهاز التحليل")}
      description={tr(
        "Import mapped analyzer observations into the clinical draft only. This does not verify or release any result; separate clinical validation is mandatory.",
        "يستورد مشاهدات الجهاز المربوطة إلى مسودة النتيجة فقط، ولا يتحقق من النتيجة أو يصدرها؛ يلزم اعتماد سريري منفصل.",
      )}>
      {open && <form className="catalog-form" onSubmit={commit}>
        <p className="form-span">{tr(
          `Confirm import of ${importIds.length} selected mapped analyzer observation(s)?`,
          `هل تؤكد استيراد ${importIds.length} من مشاهدات الجهاز المحددة والمربوطة؟`,
        )}</p>
        <p className="muted form-span">{tr(
          "Raw interface messages and their provenance remain traceable. Review sample identity, QC flags, branch and analyzer method before authorizing clinical validation.",
          "تبقى رسائل واجهة الجهاز الخام ومصدرها قابلة للتتبع. راجع هوية العينة وQC والفرع وطريقة الجهاز قبل اعتماد النتيجة سريرياً.",
        )}</p>
        {formError && <p role="alert" className="form-error form-span">{formError}</p>}
        <button type="submit" className="primary-button form-span"
          disabled={busy || importIds.length === 0}>
          {busy ? tr("Importing…", "جارٍ الاستيراد…") :
            tr("Confirm draft import", "تأكيد استيراد المسودة")}
        </button>
      </form>}
    </CrudModal>
  </div>;
}
