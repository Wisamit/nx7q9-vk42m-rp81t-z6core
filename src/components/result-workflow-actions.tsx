"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Communication = {
  id: string;
  method: string;
  outcome: string;
  recipientName: string;
  recipientRole: string | null;
  acknowledgementConfirmed: boolean;
  readBackConfirmed: boolean;
  communicatedAt: string;
  communicatedBy: string;
};

export function ResultWorkflowActions({
  resultId,
  resultStatus,
  criticalCount,
  criticalEventStatus,
  criticalAcknowledgementDueAt,
  criticalEscalationLevel,
  criticalMaxEscalationLevel,
  criticalNextEscalationDueAt,
  criticalRequireReadBack,
  communications,
  canCommunicate,
  canRelease,
  canAmend,
  locale,
}: {
  resultId: string;
  resultStatus: string;
  criticalCount: number;
  criticalEventStatus: string | null;
  criticalAcknowledgementDueAt: string | null;
  criticalEscalationLevel: number;
  criticalMaxEscalationLevel: number | null;
  criticalNextEscalationDueAt: string | null;
  criticalRequireReadBack: boolean;
  communications: Communication[];
  canCommunicate: boolean;
  canRelease: boolean;
  canAmend: boolean;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [showCommunication, setShowCommunication] = useState(false);
  const [showAmendment, setShowAmendment] = useState(false);

  async function submitCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("communication");
    setMessage("");

    const response = await fetch(`/api/results/${resultId}/critical-communications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: form.get("method"),
        outcome: form.get("outcome"),
        recipientName: form.get("recipientName"),
        recipientRole: form.get("recipientRole"),
        recipientContact: form.get("recipientContact"),
        acknowledgementConfirmed: form.get("acknowledgementConfirmed") === "on",
        readBackConfirmed: form.get("readBackConfirmed") === "on",
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Critical result communication recorded.", "تم تسجيل التواصل بشأن النتيجة الحرجة."));
      setShowCommunication(false);
      router.refresh();
    } else if (body.error === "read_back_confirmation_required") {
      setMessage(tr("Acknowledgement requires read-back confirmation under the active critical escalation policy.", "يتطلب الإقرار تأكيد إعادة القراءة وفق سياسة تصعيد النتائج الحرجة الفعالة."));
    } else if (body.error === "critical_escalation_limit_reached") {
      setMessage(tr("Maximum configured critical escalation level has been reached.", "تم الوصول إلى الحد الأقصى المهيأ لمستوى تصعيد النتيجة الحرجة."));
    } else {
      setMessage(body.error || tr("Could not record communication.", "تعذر تسجيل التواصل."));
    }
    setBusy("");
  }

  async function releaseResult() {
    if (!confirm(tr("Release this verified result? A new immutable diagnostic report version will be created.", "هل تريد إصدار هذه النتيجة المتحقق منها؟ سيتم إنشاء إصدار تقرير تشخيصي جديد غير قابل للتغيير."))) return;
    setBusy("release");
    setMessage("");

    const response = await fetch(`/api/results/${resultId}/release`, { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(`${tr("Result released. Report version", "تم إصدار النتيجة. إصدار التقرير")} ${body.reportVersion} ${tr("created as", "أُنشئ بحالة")} ${body.reportStatus}.`);
      router.refresh();
    } else if (body.error === "critical_acknowledgement_required") {
      setMessage(tr("Release blocked: the critical result must be communicated and acknowledged first.", "الإصدار محظور: يجب أولًا التواصل بشأن النتيجة الحرجة وتوثيق الإقرار بها."));
    } else {
      setMessage(body.error || tr("Result release failed.", "فشل إصدار النتيجة."));
    }
    setBusy("");
  }

  async function startAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;

    if (!confirm(tr("Start an amendment? The released result will remain preserved while a new version is prepared.", "بدء تعديل؟ ستبقى النتيجة الصادرة محفوظة بينما يتم إعداد إصدار جديد."))) return;

    setBusy("amend");
    setMessage("");

    const response = await fetch(`/api/results/${resultId}/amend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(`${tr("Amendment version", "تم إنشاء إصدار التعديل")} ${body.version}.`);
      setShowAmendment(false);
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not start amendment.", "تعذر بدء التعديل."));
    }
    setBusy("");
  }

  const criticalAcknowledged = criticalCount === 0 || criticalEventStatus === "ACKNOWLEDGED" || criticalEventStatus === "CLOSED";

  return <div className="result-workflow-box">
    <div className="result-workflow-status">
      <div><span>{tr("Result status", "حالة النتيجة")}</span><strong>{resultStatus}</strong></div>
      <div><span>{tr("Critical values", "القيم الحرجة")}</span><strong>{criticalCount}</strong></div>
      <div><span>{tr("Critical communication", "التواصل بشأن النتيجة الحرجة")}</span><strong>{criticalCount === 0 ? tr("Not required", "غير مطلوب") : criticalEventStatus || "OPEN"}</strong></div>
      {criticalCount > 0 && <div><span>{tr("Acknowledgement due", "موعد الإقرار")}</span><strong>{criticalAcknowledgementDueAt ? criticalAcknowledgementDueAt.replace("T"," ").slice(0,19) : tr("No policy", "لا توجد سياسة")}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Escalation level", "مستوى التصعيد")}</span><strong>{criticalEscalationLevel}{criticalMaxEscalationLevel !== null ? ` / ${criticalMaxEscalationLevel}` : ""}</strong></div>}
      {criticalCount > 0 && <div><span>{tr("Next escalation due", "موعد التصعيد التالي")}</span><strong>{criticalNextEscalationDueAt ? criticalNextEscalationDueAt.replace("T"," ").slice(0,19) : "—"}</strong></div>}
    </div>

    <div className="result-actions">
      {criticalCount > 0 && canCommunicate && ["VERIFIED","RELEASED"].includes(resultStatus) &&
        <button className="secondary-button" type="button" onClick={() => setShowCommunication(value => !value)}>{tr("Log Critical Communication", "تسجيل التواصل الحرج")}</button>}

      {resultStatus === "VERIFIED" && canRelease &&
        <button className="primary-button" type="button" disabled={busy !== "" || !criticalAcknowledged} onClick={() => void releaseResult()}>
          {busy === "release" ? tr("Releasing…", "جارٍ الإصدار…") : tr("Release Result", "إصدار النتيجة")}
        </button>}

      {resultStatus === "RELEASED" && canAmend &&
        <button className="secondary-button" type="button" onClick={() => setShowAmendment(value => !value)}>{tr("Start Amendment", "بدء تعديل")}</button>}
    </div>

    {resultStatus === "VERIFIED" && !criticalAcknowledged &&
      <p className="form-error">{tr("Release is blocked until the critical result is communicated and acknowledgement is documented.", "الإصدار محظور حتى يتم التواصل بشأن النتيجة الحرجة وتوثيق الإقرار.")}</p>}

    {showCommunication && <form className="catalog-form result-workflow-form" onSubmit={submitCommunication}>
      <label>{tr("Method", "الطريقة")}
        <select name="method" required defaultValue="PHONE">
          <option>PHONE</option><option>VERBAL</option><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option><option>OTHER</option>
        </select>
      </label>
      <label>{tr("Outcome", "النتيجة")}
        <select name="outcome" required defaultValue="ACKNOWLEDGED">
          <option>ACKNOWLEDGED</option><option>NO_ANSWER</option><option>LEFT_MESSAGE</option><option>FAILED</option><option>ESCALATED</option>
        </select>
      </label>
      <label>{tr("Recipient name", "اسم المستلم")}<input name="recipientName" required maxLength={200} /></label>
      <label>{tr("Recipient role", "صفة المستلم")}<input name="recipientRole" maxLength={150} placeholder={tr("Physician / nurse / patient / other", "طبيب / ممرض / مريض / أخرى")} /></label>
      <label className="form-span">{tr("Recipient contact", "بيانات تواصل المستلم")}<input name="recipientContact" maxLength={200} /></label>
      <label className="check-line"><input type="checkbox" name="acknowledgementConfirmed" /> {tr("Acknowledgement confirmed", "تم تأكيد الإقرار")}</label>
      <label className="check-line"><input type="checkbox" name="readBackConfirmed" /> {tr("Read-back confirmed", "تم تأكيد إعادة القراءة")}{criticalRequireReadBack ? " {tr("(required for acknowledgement)", "(مطلوب للإقرار)")}" : ""}</label>
      <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy === "communication"}>{busy === "communication" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Communication", "حفظ التواصل")}</button>
    </form>}

    {showAmendment && <form className="catalog-form result-workflow-form" onSubmit={startAmendment}>
      <label className="form-span">{tr("Amendment reason", "سبب التعديل")}
        <textarea name="reason" rows={3} required maxLength={1000} placeholder={tr("Reason for correcting the released result…", "سبب تصحيح النتيجة الصادرة…")} />
      </label>
      <button className="primary-button form-span" disabled={busy === "amend"}>{busy === "amend" ? tr("Creating…", "جارٍ الإنشاء…") : tr("Create Amendment Version", "إنشاء إصدار تعديل")}</button>
    </form>}

    {communications.length > 0 && <details className="specimen-history">
      <summary>{tr("Critical communication history", "سجل التواصل بشأن النتائج الحرجة")} ({communications.length})</summary>
      <div className="summary-list">
        {communications.map(item => <div key={item.id}>
          <span>{item.communicatedAt.replace("T"," ").slice(0,19)} · {item.communicatedBy} · {item.method}</span>
          <strong>{item.outcome} · {item.recipientName}{item.recipientRole ? ` (${item.recipientRole})` : ""}{item.readBackConfirmed ? " · read-back" : ""}</strong>
        </div>)}
      </div>
    </details>}

    {message && <p className="form-success">{message}</p>}
  </div>;
}
