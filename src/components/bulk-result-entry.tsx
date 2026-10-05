"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BulkField = {
  componentId: string | null;
  code: string;
  nameEn: string;
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
  currentValue: string;
};

type BulkRow = {
  orderItemId: string;
  accessionNumber: string;
  patientNumber: string;
  patientName: string;
  testCode: string;
  testName: string;
  specimenId: string;
  barcode: string;
  performingBranchId: string;
  fields: BulkField[];
  comments: string;
};

function inputFor(
  field: BulkField,
  value: string,
  onChange: (value: string) => void,
) {
  if (field.resultType === "BOOLEAN") return <select value={value} onChange={event => onChange(event.target.value)}>
    <option value="">—</option><option value="true">True</option><option value="false">False</option>
  </select>;
  if (field.resultType === "DATE") return <input type="date" value={value} onChange={event => onChange(event.target.value)} />;
  if (field.resultType === "NUMERIC") return <input inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} placeholder="Value" />;
  return <input value={value} onChange={event => onChange(event.target.value)} placeholder={field.resultType === "TEXT" ? "Text result" : "Result"} />;
}

export function BulkResultEntry({ rows }: { rows: BulkRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialValues = useMemo(() => Object.fromEntries(rows.map(row => [
    row.orderItemId,
    Object.fromEntries(row.fields.map(field => [field.componentId || "__TEST__", field.currentValue])),
  ])), [rows]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>(initialValues);
  const [comments, setComments] = useState<Record<string, string>>(Object.fromEntries(rows.map(row => [row.orderItemId, row.comments])));
  const [states, setStates] = useState<Record<string, { status: "idle" | "saving" | "ok" | "error"; message?: string }>>({});
  const [busy, setBusy] = useState(false);

  const enteredCount = rows.filter(row =>
    row.fields.some(field => (values[row.orderItemId]?.[field.componentId || "__TEST__"] || "").trim() !== "")
    || (comments[row.orderItemId] || "").trim() !== ""
  ).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enteredCount === 0) return;
    setBusy(true);
    let successful = 0;

    for (const row of rows) {
      const rowValues = values[row.orderItemId] || {};
      const hasInput = row.fields.some(field => (rowValues[field.componentId || "__TEST__"] || "").trim() !== "")
        || (comments[row.orderItemId] || "").trim() !== "";
      if (!hasInput) continue;

      setStates(current => ({ ...current, [row.orderItemId]: { status: "saving" } }));
      const response = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderItemId: row.orderItemId,
          specimenId: row.specimenId,
          performingBranchId: row.performingBranchId,
          comments: comments[row.orderItemId] || "",
          values: row.fields.map(field => ({
            componentId: field.componentId,
            rawValue: rowValues[field.componentId || "__TEST__"] || "",
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        successful++;
        const notices = [
          body.criticalCount ? body.criticalCount + " critical" : "",
          body.deltaExceededCount ? body.deltaExceededCount + " delta" : "",
          body.blockingValidationHoldCount ? body.blockingValidationHoldCount + " hold" : "",
        ].filter(Boolean);
        setStates(current => ({
          ...current,
          [row.orderItemId]: {
            status: "ok",
            message: body.autoVerified ? "Saved · autoverified" : notices.length ? "Saved · " + notices.join(" · ") : body.complete ? "Saved · ready for verification" : "Draft saved",
          },
        }));
      } else {
        setStates(current => ({
          ...current,
          [row.orderItemId]: { status: "error", message: body.error || "Save failed" },
        }));
      }
    }

    setBusy(false);
    if (successful > 0) router.refresh();
  }

  if (rows.length === 0) return null;

  return <section className="bulk-entry-panel detail-section">
    <div className="bulk-entry-head">
      <div><p className="eyebrow">Keyboard-oriented workflow</p><h2>Bulk Result Entry</h2><p className="muted">Each row is saved through the same reference-range, critical, delta, reflex, hold and autoverification rules as individual entry.</p></div>
      <button type="button" className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? "Close Bulk Entry" : "Open Bulk Entry"}</button>
    </div>
    {open && <form onSubmit={submit}>
      <div className="bulk-result-list">
        {rows.map(row => {
          const state = states[row.orderItemId] || { status: "idle" as const };
          return <article className={"bulk-result-row bulk-" + state.status} key={row.orderItemId}>
            <div className="bulk-result-context">
              <strong>{row.testCode} — {row.testName}</strong>
              <span>{row.accessionNumber} · {row.patientNumber} · {row.patientName}</span>
              <small className="barcode-text">{row.barcode}</small>
            </div>
            <div className="bulk-result-fields">
              {row.fields.map(field => {
                const key = field.componentId || "__TEST__";
                return <label key={key}><span>{field.code}</span>{inputFor(field, values[row.orderItemId]?.[key] || "", value => setValues(current => ({
                  ...current,
                  [row.orderItemId]: { ...(current[row.orderItemId] || {}), [key]: value },
                })))}</label>;
              })}
              <label className="bulk-comment"><span>Comment</span><input value={comments[row.orderItemId] || ""} onChange={event => setComments(current => ({ ...current, [row.orderItemId]: event.target.value }))} /></label>
            </div>
            <div className="bulk-row-state">
              {state.status === "saving" ? "Saving…" : state.message || "Ready"}
            </div>
          </article>;
        })}
      </div>
      <div className="bulk-actions">
        <span>{enteredCount} row(s) with entered data</span>
        <button className="primary-button" disabled={busy || enteredCount === 0}>{busy ? "Saving batch…" : "Save Entered Results"}</button>
      </div>
    </form>}
  </section>;
}
