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
}: {
  resultId: string;
  events: ReflexEvent[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function review(eventId: string, action: "ACKNOWLEDGE" | "DISMISS") {
    const note = action === "DISMISS" ? window.prompt("Optional dismissal note:") || "" : "";
    if (!window.confirm(action === "ACKNOWLEDGE"
      ? "Acknowledge this reflex recommendation as reviewed?"
      : "Dismiss this reflex recommendation?")) return;

    setBusy(eventId + action);
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/reflex/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Reflex recommendation updated." : body.error || "Could not update reflex recommendation.");
    setBusy("");
    if (response.ok) router.refresh();
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>Reflex Recommendations</h3>
      <p className="muted">These rules recommend follow-up testing. They do not automatically add tests or charges.</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className={`reflex-card reflex-${event.status.toLowerCase()}`} key={event.id}>
        <div>
          <span className="eyebrow">{event.status}</span>
          <strong>{event.targetTestCode} — {event.targetTestName}</strong>
          <small>Triggered by result value: {event.triggerValue}</small>
          {event.noteEn && <small>{event.noteEn}</small>}
          {event.reviewedBy && <small>Reviewed by {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.reviewNote && <small>Review note: {event.reviewNote}</small>}
        </div>
        {event.status === "PENDING" && canReview && <div className="result-actions">
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event.id, "ACKNOWLEDGE")}>Acknowledge</button>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event.id, "DISMISS")}>Dismiss</button>
        </div>}
      </article>)}
    </div>
    {message && <p className="form-success">{message}</p>}
  </div>;
}
