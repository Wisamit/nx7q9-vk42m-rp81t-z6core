"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const [error, setError] = useState("");
  const [pendingHoldId, setPendingHoldId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const pendingHold = events.find(event => event.id === pendingHoldId) || null;

  function openHoldReview(event: HoldEvent) {
    if (!canReview || busy || event.status !== "ACTIVE" || event.severity !== "BLOCK") return;
    setPendingHoldId(event.id);
    setReviewNote("");
    setError("");
    setMessage("");
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingHold || !canReview || busy) return;
    const current = events.find(item => item.id === pendingHold.id);
    if (!current || current.status !== "ACTIVE" || current.severity !== "BLOCK") {
      setError(tr("The hold state has changed. Refresh before retrying.",
        "تغيّرت حالة الحجز. حدّث الصفحة قبل إعادة المحاولة."));
      return;
    }
    const note = reviewNote.trim();
    if (!note) {
      setError(tr("A documented resolution note is required.", "ملاحظة حل موثقة مطلوبة."));
      return;
    }
    setBusy(current.id);
    setError("");
    try {
      const response = await fetch(`/api/results/${resultId}/holds/${current.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESOLVE", note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || tr("Could not resolve validation hold.", "تعذر حل حجز التحقق."));
        return;
      }
      setMessage(tr("Validation hold resolved.", "تم حل حجز التحقق."));
      setPendingHoldId(null);
      setReviewNote("");
      router.refresh();
    } catch {
      setError(tr("Connection interrupted; verify the hold state before retrying.",
        "انقطع الاتصال؛ تحقق من حالة الحجز قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>{tr("Validation Holds", "حجوزات التحقق")}</h3>
      <p className="muted">{tr("Blocking holds must be reviewed and resolved before verification. Warning holds remain visible for review.",
        "يجب مراجعة الحجوزات المانعة وحلها قبل التحقق، وتبقى التحذيرات ظاهرة للمراجعة.")}</p>
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
          <button className="secondary-button" type="button" disabled={busy !== ""}
            onClick={() => openHoldReview(event)}>
            {busy === event.id ? tr("Resolving…", "جارٍ الحل…") : tr("Review and Resolve Hold", "مراجعة الحجز وحله")}
          </button>
        </div>}
      </article>)}
    </div>

    <CrudModal open={pendingHold !== null} onClose={() => { if (!busy) setPendingHoldId(null); }}
      size="compact"
      title={tr("Resolve Blocking Validation Hold", "حل حجز تحقق مانع")}
      description={tr(
        "This recorded review may permit later result validation. Verify the hold and enter a traceable note; resolving does NOT automatically release a result.",
        "قد تسمح هذه المراجعة الموثقة باعتماد النتيجة لاحقاً. تحقق من الحجز واكتب ملاحظة؛ لا يؤدي حل الحجز إلى إصدار النتيجة تلقائياً.",
      )}>
      {pendingHold && <form className="catalog-form" onSubmit={event => void resolve(event)}>
        <p className="form-span"><strong>{pendingHold.severity} · {pendingHold.status}</strong></p>
        <p className="form-span">{locale === "ar" ? pendingHold.reasonAr || pendingHold.reasonEn : pendingHold.reasonEn}</p>
        <label className="form-span">
          {tr("Resolution evidence / note (required)", "أدلة الحل أو الملاحظة (مطلوبة)")}
          <textarea value={reviewNote} onChange={event => setReviewNote(event.target.value)}
            maxLength={4000} rows={4} required />
        </label>
        {error && <p className="form-error form-span" role="alert">{error}</p>}
        <button type="submit" className="primary-button form-span"
          disabled={busy !== "" || !canReview || !reviewNote.trim()}>
          {busy ? tr("Saving review…", "جارٍ حفظ المراجعة…") :
            tr("Confirm hold resolution", "تأكيد حل الحجز")}
        </button>
      </form>}
    </CrudModal>
    {message && <p className="form-success" role="status">{message}</p>}
  </div>;
}
