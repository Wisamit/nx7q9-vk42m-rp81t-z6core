"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ReflexEvent = {
  id: string;
  status: string;
  targetTestId: string;
  createdAt: string;
  confirmedOrderItemId: string | null;
  triggerValue: string;
  targetTestCode: string;
  targetTestName: string;
  noteEn: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

type BilledCandidate = {
  orderItemId: string;
  invoiceLineId: string;
  testId: string;
  orderedAt: string;
  accessionNumber: string;
  testCode: string;
  invoiceNumber: string;
  lineTotal: string;
  currency: string;
};

export function ReflexReviewPanel({
  resultId,
  events,
  canReview,
  canConfirmOrder,
  billedCandidates,
  locale,
}: {
  resultId: string;
  events: ReflexEvent[];
  canReview: boolean;
  canConfirmOrder: boolean;
  billedCandidates: BilledCandidate[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});

  async function review(event: ReflexEvent, action: "ACKNOWLEDGE" | "DISMISS" | "CONFIRM_ORDERED") {
    const note = window.prompt(tr(
      "Document your clinical decision (at least 10 characters):",
      "دوّن سبب القرار السريري (10 أحرف على الأقل):",
    ));
    if (note === null) return;
    if (note.trim().length < 10 || note.trim().length > 1000) {
      setMessage(tr("A clinical reason between 10 and 1000 characters is required.", "يجب إدخال سبب سريري من 10 إلى 1000 حرف."));
      return;
    }
    const candidate = action === "CONFIRM_ORDERED"
      ? billedCandidates.find(x => x.orderItemId + "|" + x.invoiceLineId === selected[event.id]
        && x.testId === event.targetTestId && x.orderedAt >= event.createdAt)
      : null;
    if (action === "CONFIRM_ORDERED" && !candidate) {
      setMessage(tr("Select a valid billed follow-up test.", "اختر فحص متابعة مفوترًا وصالحًا."));
      return;
    }
    const question = action === "CONFIRM_ORDERED"
      ? tr("Confirm an EXISTING billed order item? This does not create an order or charge. Verify patient, accession, price, specimen and consent.",
        "هل تؤكد ربط فحص مفوتر موجود؟ لن ينشئ هذا الطلب فحصًا أو رسومًا جديدة. تحقق من المريض والطلب والسعر والعينة والموافقة.")
      : action === "DISMISS"
        ? tr("Dismiss this Reflex recommendation with your clinical reason?", "رفض توصية Reflex مع توثيق السبب السريري؟")
        : tr("Mark as reviewed ONLY; this does not confirm that a follow-up test was ordered.", "إقرار المراجعة فقط؛ لا يعني أن فحص المتابعة قد طُلب.");
    if (!window.confirm(question)) return;
    setBusy(event.id + action); setMessage("");
    try {
      const response = await fetch("/api/results/" + resultId + "/reflex/" + event.id, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, note: note.trim(),
          ...(candidate ? { targetOrderItemId: candidate.orderItemId, invoiceLineId: candidate.invoiceLineId, billingAcknowledged: true } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      setMessage(response.ok ? tr("Reflex decision recorded.", "تم توثيق قرار Reflex.")
        : body.error || tr("Reflex decision failed.", "تعذر تسجيل قرار Reflex."));
      if (response.ok) router.refresh();
    } finally { setBusy(""); }
  }
  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>{tr("Reflex Recommendations", "توصيات الفحوصات الانعكاسية")}</h3>
      <p className="muted">{tr("These rules recommend follow-up testing. They do not automatically add tests or charges.", "توصي هذه القواعد بفحوصات متابعة ولا تضيف فحوصات أو رسومًا تلقائيًا.")}</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className={`reflex-card reflex-${event.status.toLowerCase()}`} key={event.id}>
        <div>
          <span className="eyebrow">{event.status}</span>
          <strong>{event.targetTestCode} — {event.targetTestName}</strong>
          <small>{tr("Triggered by result value", "تم التفعيل بقيمة النتيجة")}: {event.triggerValue}</small>
          {event.noteEn && <small>{event.noteEn}</small>}
          {event.reviewedBy && <small>{tr("Reviewed by", "تمت المراجعة بواسطة")} {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.confirmedOrderItemId && <small>{tr("Confirmed billed order item", "فحص المتابعة المفوتر والمؤكد")}: {event.confirmedOrderItemId}</small>}
          {event.reviewNote && <small>{tr("Review note", "ملاحظة المراجعة")}: {event.reviewNote}</small>}
        </div>
        {event.status === "PENDING" && canReview && <div className="result-actions" style={{flexWrap:"wrap"}}>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event, "ACKNOWLEDGE")}>{tr("Reviewed only", "تمت المراجعة فقط")}</button>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void review(event, "DISMISS")}>{tr("Dismiss", "رفض")}</button>
          {canConfirmOrder && <div>
            <label htmlFor={"reflex-candidate-" + event.id}>{tr("Existing invoice / test for confirmation", "فحص وفاتورة موجودان للتأكيد")}</label>
            <select id={"reflex-candidate-" + event.id} value={selected[event.id] || ""}
              onChange={e => setSelected(current => ({...current, [event.id]:e.target.value}))}>
              <option value="">{tr("Choose a billed follow-up item", "اختر فحص متابعة مفوترًا")}</option>
              {billedCandidates.filter(candidate => candidate.testId === event.targetTestId && candidate.orderedAt >= event.createdAt)
                .map(candidate => <option key={candidate.orderItemId + candidate.invoiceLineId}
                  value={candidate.orderItemId + "|" + candidate.invoiceLineId}>
                  {candidate.accessionNumber} · {candidate.testCode} · {candidate.invoiceNumber} · {candidate.lineTotal} {candidate.currency}
                </option>)}
            </select>
            <button className="secondary-button" type="button" disabled={busy !== "" || !selected[event.id]}
              onClick={() => void review(event, "CONFIRM_ORDERED")}>
              {tr("Confirm existing billed test", "تأكيد الفحص المفوتر الموجود")}
            </button>
            <p className="muted"><Link href="/orders">{tr("Register a new follow-up through the standard order and billing workflow", "سجّل فحص متابعة جديد عبر مسار الطلبات والفوترة المعتاد")}</Link></p>
          </div>}
        </div>}
      </article>)}
    </div>
    {message && <p className="form-success">{message}</p>}
  </div>;
}
