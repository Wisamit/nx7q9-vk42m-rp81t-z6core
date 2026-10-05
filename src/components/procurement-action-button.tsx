"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProcurementActionButton({
  endpoint,
  label,
  confirmText,
}: {
  endpoint: string;
  label: string;
  confirmText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(endpoint, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Updated." : body.error || "Action failed.");
    setBusy(false);
    if (response.ok) router.refresh();
  }

  return <span>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run()}>
      {busy ? "Working…" : label}
    </button>
    {message && <small className="muted">{message}</small>}
  </span>;
}
