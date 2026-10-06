"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProcurementActionButton({
  endpoint,
  label,
  confirmText,
  locale,
}: {
  endpoint: string;
  label: string;
  confirmText: string;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function run() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(endpoint, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? tr("Updated.", "تم التحديث.") : tr("Action failed.", "فشلت العملية."));
    setBusy(false);
    if (response.ok) router.refresh();
  }

  return <span>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run()}>
      {busy ? tr("Working…", "جارٍ التنفيذ…") : label}
    </button>
    {message && <small className="muted">{message}</small>}
  </span>;
}
