"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzerMessageReplayButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function replay() {
    if (!confirm("Queue this analyzer message for replay? The original raw payload remains unchanged.")) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/analyzers/messages/${messageId}/replay`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      router.refresh();
    } else {
      setMessage(body.error || "Replay could not be queued.");
    }
  }

  return <span>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void replay()}>{busy ? "Queuing…" : "Replay"}</button>
    {message && <small className="form-error">{message}</small>}
  </span>;
}
