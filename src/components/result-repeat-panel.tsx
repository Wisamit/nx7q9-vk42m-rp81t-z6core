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

export function ResultRepeatPanel({ resultId, events, locale }: { resultId: string; events: RepeatEvent[]; locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
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
      setMessage(type === "RERUN" ? tr("Rerun marker recorded.", "تم تسجيل إعادة التشغيل.") : tr("Repeat marker recorded.", "تم تسجيل إعادة الفحص."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not record marker.", "تعذر تسجيل العلامة."));
    }
    setBusy(false);
  }

  return <div className="repeat-panel">
    <div className="section-title-row">
      <div><p className="eyebrow">{tr("Analytical traceability", "التتبع التحليلي")}</p><h3>{tr("Rerun / Repeat Markers", "علامات إعادة التشغيل / إعادة الفحص")}</h3></div>
      <span className="keyboard-hint">{events.length} {tr("historical marker(s)", "علامة تاريخية")}</span>
    </div>
    <p className="muted">{tr("Markers never overwrite or unlock released results. They record why another analytical run or clinical repeat was requested.", "لا تقوم هذه العلامات بالكتابة فوق النتائج الصادرة أو فتحها للتعديل، بل تسجل سبب طلب تشغيل تحليلي آخر أو إعادة الفحص.")}</p>
    <form className="repeat-form" onSubmit={submit}>
      <select value={type} onChange={event => setType(event.target.value as "RERUN" | "REPEAT")}>
        <option value="RERUN">{tr("RERUN — same ordered test/specimen analysis", "إعادة تشغيل — نفس الفحص والعينة")}</option>
        <option value="REPEAT">{tr("REPEAT — repeat testing requested", "إعادة فحص — طُلب تكرار الفحص")}</option>
      </select>
      <input value={reason} onChange={event => setReason(event.target.value)} placeholder={tr("Reason is required…", "السبب مطلوب…")} maxLength={1000} required />
      <button className="secondary-button" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Record Marker", "تسجيل العلامة")}</button>
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
