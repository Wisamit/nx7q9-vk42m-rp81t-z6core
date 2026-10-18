"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function acknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open || inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/worklists/${orderItemId}/tat-escalations/${eventId}/acknowledge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        },
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        setOpen(false);
        setNote("");
        router.refresh();
      } else {
        setMessage(body.error || tr("Could not acknowledge TAT escalation. Check its current status.",
          "تعذر إقرار تصعيد TAT. تحقق من حالته الحالية."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Verify the escalation before retrying.",
        "انقطع الاتصال. تحقق من التصعيد قبل إعادة المحاولة."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => {
      if (inFlight.current) return;
      setNote("");
      setMessage("");
      setOpen(true);
    }}>
      {busy ? tr("Acknowledging…", "جارٍ الإقرار…") : tr("Acknowledge", "إقرار")}
    </button>
    <CrudModal open={open} onClose={() => { if (!inFlight.current) setOpen(false); }}
      title={tr("Acknowledge TAT Escalation", "إقرار تصعيد زمن الإنجاز")}
      description={tr(
        "Confirm the exact escalation before recording an acknowledgement. This records an operator action; it does not resolve an overdue test or release a clinical result.",
        "تأكد من التصعيد المحدد قبل تسجيل الإقرار. هذا يوثق إجراء الموظف ولا يعالج التأخير أو يصدر نتيجة سريرية.",
      )}
      size="compact">
      {open && <form className="catalog-form" onSubmit={acknowledge}>
        <p className="form-span"><strong>{tr("Escalation level", "مستوى التصعيد")}:</strong> {level}</p>
        <p className="form-span"><strong>{tr("Escalation event", "حدث التصعيد")}:</strong> {eventId}</p>
        <label className="form-span">{tr("Acknowledgement note (optional)", "ملاحظة الإقرار (اختيارية)")}
          <textarea rows={3} maxLength={1000} value={note}
            onChange={event => setNote(event.target.value)} />
        </label>
        {message && <p role="alert" className="form-error form-span">{message}</p>}
        <div className="crud-modal-actions form-span">
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => setOpen(false)}>{tr("Cancel", "إلغاء")}</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? tr("Acknowledging…", "جارٍ الإقرار…") : tr("Confirm acknowledgement", "تأكيد الإقرار")}
          </button>
        </div>
      </form>}
    </CrudModal>
  </div>;
}
