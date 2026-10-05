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
}) {
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
      setMessage("Critical result communication recorded.");
      setShowCommunication(false);
      router.refresh();
    } else if (body.error === "read_back_confirmation_required") {
      setMessage("Acknowledgement requires read-back confirmation under the active critical escalation policy.");
    } else if (body.error === "critical_escalation_limit_reached") {
      setMessage("Maximum configured critical escalation level has been reached.");
    } else {
      setMessage(body.error || "Could not record communication.");
    }
    setBusy("");
  }

  async function releaseResult() {
    if (!confirm("Release this verified result? A new immutable diagnostic report version will be created.")) return;
    setBusy("release");
    setMessage("");

    const response = await fetch(`/api/results/${resultId}/release`, { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(`Result released. Report version ${body.reportVersion} created as ${body.reportStatus}.`);
      router.refresh();
    } else if (body.error === "critical_acknowledgement_required") {
      setMessage("Release blocked: the critical result must be communicated and acknowledged first.");
    } else {
      setMessage(body.error || "Result release failed.");
    }
    setBusy("");
  }

  async function startAmendment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) return;

    if (!confirm("Start an amendment? The released result will remain preserved while a new version is prepared.")) return;

    setBusy("amend");
    setMessage("");

    const response = await fetch(`/api/results/${resultId}/amend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(`Amendment version ${body.version} created.`);
      setShowAmendment(false);
      router.refresh();
    } else {
      setMessage(body.error || "Could not start amendment.");
    }
    setBusy("");
  }

  const criticalAcknowledged = criticalCount === 0 || criticalEventStatus === "ACKNOWLEDGED" || criticalEventStatus === "CLOSED";

  return <div className="result-workflow-box">
    <div className="result-workflow-status">
      <div><span>Result status</span><strong>{resultStatus}</strong></div>
      <div><span>Critical values</span><strong>{criticalCount}</strong></div>
      <div><span>Critical communication</span><strong>{criticalCount === 0 ? "Not required" : criticalEventStatus || "OPEN"}</strong></div>
      {criticalCount > 0 && <div><span>Acknowledgement due</span><strong>{criticalAcknowledgementDueAt ? criticalAcknowledgementDueAt.replace("T"," ").slice(0,19) : "No policy"}</strong></div>}
      {criticalCount > 0 && <div><span>Escalation level</span><strong>{criticalEscalationLevel}{criticalMaxEscalationLevel !== null ? ` / ${criticalMaxEscalationLevel}` : ""}</strong></div>}
      {criticalCount > 0 && <div><span>Next escalation due</span><strong>{criticalNextEscalationDueAt ? criticalNextEscalationDueAt.replace("T"," ").slice(0,19) : "—"}</strong></div>}
    </div>

    <div className="result-actions">
      {criticalCount > 0 && canCommunicate && ["VERIFIED","RELEASED"].includes(resultStatus) &&
        <button className="secondary-button" type="button" onClick={() => setShowCommunication(value => !value)}>Log Critical Communication</button>}

      {resultStatus === "VERIFIED" && canRelease &&
        <button className="primary-button" type="button" disabled={busy !== "" || !criticalAcknowledged} onClick={() => void releaseResult()}>
          {busy === "release" ? "Releasing…" : "Release Result"}
        </button>}

      {resultStatus === "RELEASED" && canAmend &&
        <button className="secondary-button" type="button" onClick={() => setShowAmendment(value => !value)}>Start Amendment</button>}
    </div>

    {resultStatus === "VERIFIED" && !criticalAcknowledged &&
      <p className="form-error">Release is blocked until the critical result is communicated and acknowledgement is documented.</p>}

    {showCommunication && <form className="catalog-form result-workflow-form" onSubmit={submitCommunication}>
      <label>Method
        <select name="method" required defaultValue="PHONE">
          <option>PHONE</option><option>VERBAL</option><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option><option>OTHER</option>
        </select>
      </label>
      <label>Outcome
        <select name="outcome" required defaultValue="ACKNOWLEDGED">
          <option>ACKNOWLEDGED</option><option>NO_ANSWER</option><option>LEFT_MESSAGE</option><option>FAILED</option><option>ESCALATED</option>
        </select>
      </label>
      <label>Recipient name<input name="recipientName" required maxLength={200} /></label>
      <label>Recipient role<input name="recipientRole" maxLength={150} placeholder="Physician / nurse / patient / other" /></label>
      <label className="form-span">Recipient contact<input name="recipientContact" maxLength={200} /></label>
      <label className="check-line"><input type="checkbox" name="acknowledgementConfirmed" /> Acknowledgement confirmed</label>
      <label className="check-line"><input type="checkbox" name="readBackConfirmed" /> Read-back confirmed{criticalRequireReadBack ? " (required for acknowledgement)" : ""}</label>
      <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
      <button className="primary-button form-span" disabled={busy === "communication"}>{busy === "communication" ? "Saving…" : "Save Communication"}</button>
    </form>}

    {showAmendment && <form className="catalog-form result-workflow-form" onSubmit={startAmendment}>
      <label className="form-span">Amendment reason
        <textarea name="reason" rows={3} required maxLength={1000} placeholder="Reason for correcting the released result…" />
      </label>
      <button className="primary-button form-span" disabled={busy === "amend"}>{busy === "amend" ? "Creating…" : "Create Amendment Version"}</button>
    </form>}

    {communications.length > 0 && <details className="specimen-history">
      <summary>Critical communication history ({communications.length})</summary>
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
