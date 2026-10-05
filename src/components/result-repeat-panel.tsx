"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type RepeatEvent = {
  id: string;
  type: "RERUN" | "REPEAT";
  reason: string;
  requestedAt: string;
  requestedBy: string;
};

export function ResultRepeatPanel({ resultId, events }: { resultId: string; events: RepeatEvent[] }) {
  const router = useRouter();
  const [type, setType] = useState<"RERUN" | "REPEAT">("RERUN");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/results/${resultId}/repeat-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, reason }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setReason("");
      setMessage(type === "RERUN" ? "Rerun marker recorded." : "Repeat marker recorded.");
      router.refresh();
    } else {
      setMessage(body.error || "Could not record marker.");
    }
    setBusy(false);
  }

  return <div className="repeat-panel">
    <div className="section-title-row">
      <div><p className="eyebrow">Analytical traceability</p><h3>Rerun / Repeat Markers</h3></div>
      <span className="keyboard-hint">{events.length} historical marker(s)</span>
    </div>
    <p className="muted">Markers never overwrite or unlock released results. They record why another analytical run or clinical repeat was requested.</p>
    <form className="repeat-form" onSubmit={submit}>
      <select value={type} onChange={event => setType(event.target.value as "RERUN" | "REPEAT")}>
        <option value="RERUN">RERUN — same ordered test/specimen analysis</option>
        <option value="REPEAT">REPEAT — repeat testing requested</option>
      </select>
      <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason is required…" maxLength={1000} required />
      <button className="secondary-button" disabled={busy}>{busy ? "Saving…" : "Record Marker"}</button>
    </form>
    {message && <p className="form-success">{message}</p>}
    {events.length > 0 && <div className="repeat-history">
      {events.map(item => <div key={item.id}>
        <span className={"status-badge " + (item.type === "RERUN" ? "status-in-progress" : "status-amended")}>{item.type}</span>
        <div><strong>{item.reason}</strong><small>{item.requestedAt.replace("T"," ").slice(0,19)} · {item.requestedBy}</small></div>
      </div>)}
    </div>}
  </div>;
}
