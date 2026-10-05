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
}: {
  resultId: string;
  events: HoldEvent[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function resolve(eventId: string) {
    const note = window.prompt("Resolution note is required:");
    if (!note?.trim()) return;
    if (!window.confirm("Resolve this validation hold after documented review?")) return;

    setBusy(eventId);
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/holds/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RESOLVE", note }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Validation hold resolved." : body.error || "Could not resolve validation hold.");
    setBusy("");
    if (response.ok) router.refresh();
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>Validation Holds</h3>
      <p className="muted">Blocking holds must be reviewed and resolved before verification. Warning holds remain visible for review.</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className="reflex-card" key={event.id}>
        <div>
          <span className="eyebrow">{event.severity} · {event.status}</span>
          <strong>{event.reasonEn}</strong>
          {event.reasonAr && <small dir="rtl">{event.reasonAr}</small>}
          {event.reviewedBy && <small>Reviewed by {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.reviewNote && <small>Review note: {event.reviewNote}</small>}
        </div>
        {event.status === "ACTIVE" && event.severity === "BLOCK" && canReview && <div className="result-actions">
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void resolve(event.id)}>
            {busy === event.id ? "Resolving…" : "Resolve Hold"}
          </button>
        </div>}
      </article>)}
    </div>
    {message && <p className="form-success">{message}</p>}
  </div>;
}
