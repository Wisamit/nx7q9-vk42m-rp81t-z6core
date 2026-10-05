"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ResultField = {
  componentId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
  unit: string | null;
  currentValue: string;
  currentFlag: string | null;
  referenceDisplay: string | null;
  critical: boolean;
  deltaEvaluation: string | null;
  deltaDisplay: string | null;
  calculated: boolean;
};

type CommentTemplateOption = {
  id: string;
  code: string;
  nameEn: string;
  textEn: string;
};

export function ResultEntryForm({
  orderItemId,
  specimenId,
  performingBranchId,
  fields,
  comments,
  resultId,
  resultStatus,
  canVerify,
  commentTemplates,
}: {
  orderItemId: string;
  specimenId: string;
  performingBranchId: string;
  fields: ResultField[];
  comments: string;
  resultId: string | null;
  resultStatus: string | null;
  canVerify: boolean;
  commentTemplates: CommentTemplateOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.componentId || "__TEST__", field.currentValue])),
  );
  const [note, setNote] = useState(comments);
  const [savedResultId, setSavedResultId] = useState(resultId);
  const [savedStatus, setSavedStatus] = useState(resultStatus);
  const [complete, setComplete] = useState(Boolean(resultId && resultStatus === "ENTERED"));
  const [busy, setBusy] = useState<"save" | "verify" | "">("");
  const [message, setMessage] = useState("");

  function fieldInput(field: ResultField) {
    const key = field.componentId || "__TEST__";
    if (field.calculated) return <div className="calculated-value-box"><strong>{values[key] || "Calculated on save"}</strong><small>Derived from configured formula</small></div>;

    const common = {
      value: values[key] || "",
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };

    if (field.resultType === "BOOLEAN") {
      return <select {...common}>
        <option value="">—</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>;
    }
    if (field.resultType === "DATE") return <input type="date" {...common} />;
    if (field.resultType === "NUMERIC") return <input inputMode="decimal" placeholder="Numeric result" {...common} />;
    if (field.resultType === "TEXT") return <textarea rows={2} placeholder="Result text" {...common} />;
    return <input placeholder="Qualitative result" {...common} />;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage("");

    const response = await fetch("/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId,
        specimenId,
        performingBranchId,
        comments: note,
        values: fields.map((field) => ({
          componentId: field.componentId,
          rawValue: values[field.componentId || "__TEST__"] || "",
        })),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setSavedResultId(body.result?.id || null);
      setSavedStatus(body.result?.status || null);
      setComplete(Boolean(body.complete));
      const notices = [];
      if (body.criticalCount > 0) notices.push(`${body.criticalCount} critical value(s)`);
      if (body.deltaExceededCount > 0) notices.push(`${body.deltaExceededCount} delta warning(s)`);
      if (body.pendingReflexCount > 0) notices.push(`${body.pendingReflexCount} reflex recommendation(s)`);
      setMessage(notices.length
        ? `Saved with ${notices.join(", ")}. Review validation items before verification.`
        : body.complete ? "Result saved and ready for verification." : "Draft saved. Complete all required result fields before verification.");
      router.refresh();
    } else {
      setMessage(body.error || "Result could not be saved.");
    }
    setBusy("");
  }

  async function verify() {
    if (!savedResultId) return;
    if (!confirm("Verify this result? Verified values become locked and later changes require an amendment.")) return;

    setBusy("verify");
    setMessage("");
    let response = await fetch(`/api/results/${savedResultId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmDeltaWarnings: false }),
    });
    let body = await response.json().catch(() => ({}));

    if (!response.ok && body.error === "delta_review_confirmation_required") {
      const confirmed = confirm(`${body.deltaExceededCount} delta-check warning(s) exceeded configured limits. Confirm that you reviewed these warnings and continue verification?`);
      if (confirmed) {
        response = await fetch(`/api/results/${savedResultId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmDeltaWarnings: true }),
        });
        body = await response.json().catch(() => ({}));
      }
    }

    if (response.ok) {
      setSavedStatus(body.resultStatus);
      setMessage(body.criticalCount > 0
        ? "Result verified. Critical result acknowledgement/communication is required before release."
        : "Result verified successfully.");
      router.refresh();
    } else if (body.error === "reflex_review_required") {
      setMessage("Verification blocked: review all pending reflex recommendations first.");
    } else {
      setMessage(body.error || "Result verification failed.");
    }
    setBusy("");
  }

  const locked = ["VERIFIED", "RELEASED", "AMENDED", "CANCELLED"].includes(savedStatus || "");

  return <form className="result-entry-form" onSubmit={save}>
    <div className="result-entry-header">
      <div><strong>Status</strong><span>{savedStatus || "NOT ENTERED"}</span></div>
      <div><strong>Source</strong><span>MANUAL</span></div>
    </div>

    <div className="result-field-list">
      {fields.map((field) => {
        const key = field.componentId || "__TEST__";
        return <div className={`result-field-row ${field.critical ? "result-critical" : ""}`} key={key}>
          <div className="result-field-name">
            <strong>{field.code} — {field.nameEn}</strong>
            {field.nameAr && <small dir="rtl">{field.nameAr}</small>}
            <small>{field.resultType}{field.unit ? ` · ${field.unit}` : ""}</small>
          </div>
          <div className="result-field-input">{locked ? <strong>{values[key] || "—"}</strong> : fieldInput(field)}</div>
          <div className="result-field-reference">
            <span>{field.referenceDisplay || "No active reference interval"}</span>
            {field.currentFlag && <strong>{field.currentFlag}</strong>}
            {field.deltaEvaluation && field.deltaEvaluation !== "NOT_CONFIGURED" && <span className={field.deltaEvaluation === "EXCEEDED" ? "delta-exceeded" : "delta-ok"}>
              Delta: {field.deltaDisplay || field.deltaEvaluation}
            </span>}
          </div>
        </div>;
      })}
    </div>

    <label className="result-comments">Comments
      {!locked && commentTemplates.length > 0 && <select
        defaultValue=""
        onChange={(event) => {
          const template = commentTemplates.find((item) => item.id === event.target.value);
          if (template) setNote((current) => current ? current + "\n" + template.textEn : template.textEn);
          event.target.value = "";
        }}
      >
        <option value="">Insert comment template…</option>
        {commentTemplates.map((template) => <option key={template.id} value={template.id}>{template.code} — {template.nameEn}</option>)}
      </select>}
      <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} disabled={locked} />
    </label>

    {message && <div className="form-success">{message}</div>}

    <div className="result-actions">
      {!locked && <button className="primary-button" disabled={busy !== ""}>{busy === "save" ? "Saving…" : "Save Result"}</button>}
      {!locked && canVerify && savedResultId && complete && <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>{busy === "verify" ? "Verifying…" : "Verify Result"}</button>}
      {locked && <span className="muted">Verified/released results are locked. Future edits must use an amendment workflow.</span>}
    </div>
  </form>;
}
