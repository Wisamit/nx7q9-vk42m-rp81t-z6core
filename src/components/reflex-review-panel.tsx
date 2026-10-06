"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ReflexEvent = {
  id: string;
  status: string;
  triggerValue: string;
  targetTestCode: string;
  targetTestName: string;
  noteEn: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export function ReflexReviewPanel({
  resultId,
  events,
  canReview,
  locale,
}: {
  resultId: string;
  events: ReflexEvent[];
  canReview: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function review(eventId: string, action: "ACKNOWLEDGE" | "DISMISS") {
    const note = action === "DISMISS" ? window.prompt(tr("Optional dismissal note:", "ملاحظة اختيارية لسبب الرفض:")) || "" : "";
    if (!window.confirm(action === "ACKNOWLEDGE"
      ? tr("Acknowledge this reflex recommendation as reviewed?", "تأكيد مراجعة توصية الفحص الانعكاسي؟")
      : tr("Dismiss this reflex recommendation?", "رفض توصية الفحص الانعكاسي؟"))) return;

    setBusy(eventId + action);
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/reflex/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? tr("Reflex recommendation updated.", "تم تحديث توصية الفحص الانعكاسي.") : body.error || tr("Could not update reflex recommendation.", "تعذر تحديث توصية الفحص الانعكاسي."));
    setBusy("");
    if (response.ok) router.refresh();
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>{tr("Reflex Recommendations", "توصيات الفحوصات الانعكاسية")}</h3>
      <p className="muted">{tr("These rules recommend follow-up testing. They do not automatically add tests or charges.", "توصي هذه القواعد بفحوصات متابعة ولا تضيف فحوصات أو رسومًا تلقائيًا.")}</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className={`reflex-card reflex-${event.status.toLowerCase()}`} key={event.id}>
        <div>
          <span className="eyebrow">{event.status}</span>
          <strong>{event.targetTestCode} — {event.targetTestName}</strong>
          <small>{tr("Triggered by result value", "تم التفعيل بقيمة النتيجة")}: {event.triggerValue}</small>
          {event.noteEn && <small>{event.noteEn}</small>}
          {event.reviewedBy && <small>{tr("Reviewed by", "تمت المراجعة بواسطة")} {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.reviewNote && <small>{tr("Review note", "ملاحظة المراجعة")}: {event.reviewNote}</small>}
        </div>
        {event.status === "PENDING" && canReview && <div className="result-actions">
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event.id, "ACKNOWLEDGE")}>{tr("Acknowledge", "إقرار")}</button>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event.id, "DISMISS")}>{tr("Dismiss", "رفض")}</button>
        </div>}
      </article>)}
    </div>
    {message && <p className="form-success">{message}</p>}
  </div>;
}
