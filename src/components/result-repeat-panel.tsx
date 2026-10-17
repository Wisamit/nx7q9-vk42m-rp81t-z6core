"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

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
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    setBusy(true); setMessage(""); setFailed(false);
    try {
    const response = await fetch(`/api/results/${resultId}/repeat-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, reason }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setReason("");
      setOpen(false);
      setMessage(type === "RERUN" ? tr("Rerun marker recorded.", "تم تسجيل إعادة التشغيل.") : tr("Repeat marker recorded.", "تم تسجيل إعادة الفحص."));
      router.refresh();
    } else {
      setFailed(true);
      setMessage(body.error || tr("Could not record marker.", "تعذر تسجيل العلامة."));
    }
    } catch {
      setFailed(true);
      setMessage(tr("Connection interrupted. Review the event register before retrying to prevent a duplicate marker.", "انقطع الاتصال. راجع سجل الأحداث قبل إعادة المحاولة لتجنب تسجيل علامة مكررة."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="repeat-panel">
    <div className="section-title-row">
      <div><p className="eyebrow">{tr("Analytical traceability", "التتبع التحليلي")}</p><h3>{tr("Rerun / Repeat Markers", "علامات إعادة التشغيل / إعادة الفحص")}</h3></div>
      <span className="keyboard-hint">{events.length} {tr("historical marker(s)", "علامة تاريخية")}</span>
    </div>
    <p className="muted">{tr("Markers never overwrite or unlock released results. They record why another analytical run or clinical repeat was requested.", "لا تقوم هذه العلامات بالكتابة فوق النتائج الصادرة أو فتحها للتعديل، بل تسجل سبب طلب تشغيل تحليلي آخر أو إعادة الفحص.")}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setMessage("");setFailed(false);setOpen(true); }}>
      {tr("Record Rerun / Repeat Marker", "تسجيل إعادة تشغيل أو إعادة فحص")}
    </button>
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }} size="compact"
      title={tr("Record analytical repeat trace", "تسجيل أثر إعادة الفحص التحليلي")}
      description={tr("A marker documents a new analytical request only; it does not change released results. Record the reason for audit.", "توثق العلامة طلباً تحليلياً جديداً فقط ولا تعدل النتائج الصادرة؛ سجّل السبب للتدقيق.")}>
    {open && <form className="catalog-form" onSubmit={submit}>
      <label>{tr("Marker type", "نوع العلامة")}<select value={type} onChange={event => setType(event.target.value as "RERUN" | "REPEAT")}>
        <option value="RERUN">{tr("RERUN — same ordered test/specimen analysis", "إعادة تشغيل — نفس الفحص والعينة")}</option>
        <option value="REPEAT">{tr("REPEAT — repeat testing requested", "إعادة فحص — طُلب تكرار الفحص")}</option>
      </select></label>
      <label>{tr("Audited reason", "سبب موثّق")}<input value={reason} onChange={event => setReason(event.target.value)} placeholder={tr("Reason is required…", "السبب مطلوب…")} maxLength={1000} required /></label>
      <div className="crud-modal-actions form-span"><button type="submit" className="primary-button" disabled={busy || !reason.trim()}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Record Marker", "تسجيل العلامة")}</button></div>
      {failed && message && <p className="form-error form-span" role="alert">{message}</p>}
    </form>}
    </CrudModal>
    {!open && message && <p className={failed ? "form-error" : "form-success"} role="status">{message}</p>}
    {events.length > 0 && <div className="repeat-history">
      {events.map(item => <div key={item.id}>
        <span className={"status-badge " + (item.type === "RERUN" ? "status-in-progress" : "status-amended")}>{item.type}</span>
        <div><strong>{item.reason}</strong><small><SystemDateText value={item.requestedAt} /> · {item.requestedBy}</small></div>
      </div>)}
    </div>}
  </div>;
}
