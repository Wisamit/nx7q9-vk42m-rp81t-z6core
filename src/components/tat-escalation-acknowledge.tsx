"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TatEscalationAcknowledge({
  orderItemId,
  eventId,
  level,
  locale,
}: {
  orderItemId: string;
  eventId: string;
  level: number;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function acknowledge() {
    const entered = prompt(tr(
      `Acknowledgement note for TAT escalation level ${level} (optional):`,
      `ملاحظة الإقرار لتصعيد TAT المستوى ${level} (اختياري):`,
    ));
    if (entered === null) return;

    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/worklists/${orderItemId}/tat-escalations/${eventId}/acknowledge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: entered.trim() }),
      },
    );
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (response.ok) router.refresh();
    else setMessage(body.error || tr("Could not acknowledge TAT escalation.", "تعذر إقرار تصعيد TAT."));
    setBusy(false);
  }

  return <div>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void acknowledge()}>
      {busy ? tr("Acknowledging…", "جارٍ الإقرار…") : tr("Acknowledge", "إقرار")}
    </button>
    {message && <small className="form-error">{message}</small>}
  </div>;
}
