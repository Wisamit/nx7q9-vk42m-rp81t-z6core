"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function AnalyzerMessageReplayButton({
  messageId,
  locale,
}: { messageId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function replay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !open) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/analyzers/messages/${messageId}/replay`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr(
          "Replay could not be queued.", "تعذر وضع الرسالة في قائمة إعادة التشغيل."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setMessage(tr(
        "Connection error; check the analyzer replay queue before retrying.",
        "خطأ في الاتصال؛ راجع قائمة إعادة تشغيل الجهاز قبل المحاولة مجدداً.",
      ));
    } finally {
      setBusy(false);
    }
  }

  return <span>
    <button className="secondary-button" type="button" disabled={busy}
      onClick={() => { setMessage(""); setOpen(true); }}>
      {busy ? tr("Queuing…", "جارٍ الإضافة للقائمة…") : tr("Replay", "إعادة التشغيل")}
    </button>
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Review Analyzer Message Replay", "مراجعة إعادة تشغيل رسالة جهاز التحليل")}
      description={tr(
        "Queuing this specific message for replay preserves its original raw payload and audit trail. Clinical result release is not authorized by replay.",
        "إعادة الرسالة المحددة إلى الطابور لا تغيّر محتواها الخام أو سجل تدقيقها، ولا تمنح صلاحية إصدار النتائج السريرية.",
      )}>
      {open && <form className="catalog-form" onSubmit={replay}>
        <p className="form-span">{tr(
          "Confirm replay of this analyzer interface message?",
          "هل تريد تأكيد إعادة تشغيل رسالة واجهة الجهاز المحددة؟",
        )}</p>
        {message && <p className="form-error form-span" role="alert">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy ? tr("Queueing…", "جارٍ الإضافة للقائمة…") :
            tr("Confirm replay", "تأكيد إعادة التشغيل")}
        </button>
      </form>}
    </CrudModal>
  </span>;
}
