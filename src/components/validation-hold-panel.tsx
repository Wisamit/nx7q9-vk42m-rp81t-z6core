"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type HoldEvent = {
  id: string;
  status: string;
  severity: string;
  reasonEn: string;
  reasonAr: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export function ValidationHoldPanel({
  resultId,
  events,
  canReview,
  locale,
}: {
  resultId: string;
  events: HoldEvent[];
  canReview: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function resolve(eventId: string) {
    const note = window.prompt(tr("Resolution note is required:", "ملاحظة الحل مطلوبة:"));
    if (!note?.trim()) return;
    if (!window.confirm(tr("Resolve this validation hold after documented review?", "حل حجز التحقق بعد توثيق المراجعة؟"))) return;

    setBusy(eventId);
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/holds/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RESOLVE", note }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? tr("Validation hold resolved.", "تم حل حجز التحقق.") : body.error || tr("Could not resolve validation hold.", "تعذر حل حجز التحقق."));
    setBusy("");
    if (response.ok) router.refresh();
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>{tr("Validation Holds", "حجوزات التحقق")}</h3>
      <p className="muted">{tr("Blocking holds must be reviewed and resolved before verification. Warning holds remain visible for review.", "يجب مراجعة الحجوزات المانعة وحلها قبل التحقق، وتبقى التحذيرات ظاهرة للمراجعة.")}</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className="reflex-card" key={event.id}>
        <div>
          <span className="eyebrow">{event.severity} · {event.status}</span>
          <strong>{locale === "ar" ? event.reasonAr || event.reasonEn : event.reasonEn}</strong>
          {locale !== "ar" && event.reasonAr && <small dir="rtl">{event.reasonAr}</small>}
          {event.reviewedBy && <small>{tr("Reviewed by", "تمت المراجعة بواسطة")} {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.reviewNote && <small>{tr("Review note", "ملاحظة المراجعة")}: {event.reviewNote}</small>}
        </div>
        {event.status === "ACTIVE" && event.severity === "BLOCK" && canReview && <div className="result-actions">
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void resolve(event.id)}>
            {busy === event.id ? tr("Resolving…", "جارٍ الحل…") : tr("Resolve Hold", "حل الحجز")}
          </button>
        </div>}
      </article>)}
    </div>
    {message && <p className="form-success">{message}</p>}
  </div>;
}
