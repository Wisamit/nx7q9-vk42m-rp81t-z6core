"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function MicrobiologyFinalWorkflow({
  caseId,
  resultId,
  resultStatus,
  finalComment,
  canEnter,
  canVerify,
  canRelease,
  orderId,
}: {
  caseId: string;
  resultId: string | null;
  resultStatus: string | null;
  finalComment: string;
  canEnter: boolean;
  canVerify: boolean;
  canRelease: boolean;
  orderId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function submitFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("submit");
    setMessage("");

    const response = await fetch(`/api/microbiology/cases/${caseId}/submit-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalComment: form.get("finalComment") }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage("Final microbiology content submitted for verification.");
      router.refresh();
    } else {
      setMessage(body.error || "Could not submit final microbiology result.");
    }
  }

  async function verify() {
    if (!resultId) return;
    if (!confirm("Verify this microbiology result? Later changes must use an amendment workflow.")) return;

    setBusy("verify");
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmDeltaWarnings: false }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage("Microbiology result verified.");
      router.refresh();
    } else if (body.error === "validation_hold_review_required") {
      setMessage("Verification blocked: resolve active blocking validation holds first.");
    } else if (body.error === "reflex_review_required") {
      setMessage("Verification blocked: review pending reflex recommendations first.");
    } else {
      setMessage(body.error || "Microbiology verification failed.");
    }
  }

  async function release() {
    if (!resultId) return;
    if (!confirm("Release this verified microbiology result? This creates a new immutable diagnostic report version.")) return;

    setBusy("release");
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/release`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage(`Microbiology result released. Report version ${body.reportVersion} created.`);
      router.refresh();
    } else {
      setMessage(body.error || "Microbiology release failed.");
    }
  }

  return <section className="detail-card detail-section">
    <h2>Final Microbiology Result</h2>
    <p className="muted">Submitting creates or updates a versioned LaboratoryResult. Verification and release remain separate controlled steps.</p>

    {canEnter && (!resultStatus || ["DRAFT","ENTERED"].includes(resultStatus)) && <form className="catalog-form" onSubmit={submitFinal}>
      <label className="form-span">Final interpretive comment
        <textarea name="finalComment" rows={4} required defaultValue={finalComment} />
      </label>
      <button className="primary-button form-span" disabled={busy !== ""}>
        {busy === "submit" ? "Submitting…" : resultId ? "Update Final Submission" : "Submit for Verification"}
      </button>
    </form>}

    <div className="result-workflow-status">
      <div><span>Laboratory result</span><strong>{resultStatus || "NOT SUBMITTED"}</strong></div>
    </div>

    <div className="result-actions">
      {resultId && resultStatus === "ENTERED" && canVerify &&
        <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>
          {busy === "verify" ? "Verifying…" : "Verify Microbiology Result"}
        </button>}
      {resultId && resultStatus === "VERIFIED" && canRelease &&
        <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => void release()}>
          {busy === "release" ? "Releasing…" : "Release Microbiology Result"}
        </button>}
      {resultStatus === "RELEASED" &&
        <a className="secondary-link" href={`/reports/${orderId}`}>Open Diagnostic Report</a>}
    </div>

    {message && <p className="form-success">{message}</p>}
  </section>;
}
