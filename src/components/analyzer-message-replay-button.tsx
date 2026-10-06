"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzerMessageReplayButton({ messageId, locale }: { messageId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function replay() {
    if (!confirm(tr("Queue this analyzer message for replay? The original raw payload remains unchanged.", "هل تريد وضع رسالة جهاز التحليل في قائمة إعادة التشغيل؟ ستبقى الحمولة الخام الأصلية دون تغيير."))) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/analyzers/messages/${messageId}/replay`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      router.refresh();
    } else {
      setMessage(tr("Replay could not be queued.", "تعذر وضع الرسالة في قائمة إعادة التشغيل."));
    }
  }

  return <span>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void replay()}>{busy ? tr("Queuing…","جارٍ الإضافة للقائمة…") : tr("Replay","إعادة التشغيل")}</button>
    {message && <small className="form-error">{message}</small>}
  </span>;
}
