"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; code: string; nameEn: string };
type Branch = { id: string; code: string; nameEn: string };

export function AutoverificationValidationManager({
  tests,
  branches,
}: {
  tests: Option[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [condition, setCondition] = useState("ALWAYS");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("policy");
    setMessage("");

    const response = await fetch("/api/clinical-rules/autoverification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        branchId: form.get("branchId"),
        enabled: form.get("enabled") === "on",
        allowManual: form.get("allowManual") === "on",
        allowAnalyzer: form.get("allowAnalyzer") === "on",
        allowImport: form.get("allowImport") === "on",
        requireAllFlagsNormal: form.get("requireAllFlagsNormal") === "on",
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Autoverification policy created." : body.error || "Could not create autoverification policy.");
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  async function createHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("hold");
    setMessage("");

    const response = await fetch("/api/clinical-rules/validation-holds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        branchId: form.get("branchId"),
        condition,
        resultSource: condition === "RESULT_SOURCE" ? form.get("resultSource") : null,
        severity: form.get("severity"),
        reasonEn: form.get("reasonEn"),
        reasonAr: form.get("reasonAr"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Validation hold rule created." : body.error || "Could not create validation hold rule.");
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      setCondition("ALWAYS");
      router.refresh();
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>Create Autoverification Policy</h2>
      <p className="muted">Autoverification stops at VERIFIED. Critical values, exceeded delta checks, pending reflex recommendations and blocking holds are mandatory hard stops.</p>
      <form className="catalog-form" onSubmit={createPolicy}>
        <label>Test<select name="testId" required defaultValue="">
          <option value="">Select test…</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Branch<select name="branchId" defaultValue="">
          <option value="">All branches</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select></label>
        <label><input name="enabled" type="checkbox" /> Enable policy</label>
        <label><input name="allowManual" type="checkbox" /> Allow manual results</label>
        <label><input name="allowAnalyzer" type="checkbox" defaultChecked /> Allow analyzer results when QC gate becomes available</label>
        <label><input name="allowImport" type="checkbox" /> Allow imported results</label>
        <label><input name="requireAllFlagsNormal" type="checkbox" /> Require all flags normal/unknown</label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "policy"}>{busy === "policy" ? "Saving…" : "Create Autoverification Policy"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Validation Hold Rule</h2>
      <p className="muted">Blocking holds stop verification until an authorized reviewer resolves them with a documented note. Warning holds remain visible but do not block.</p>
      <form className="catalog-form" onSubmit={createHold}>
        <label>Test<select name="testId" required defaultValue="">
          <option value="">Select test…</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Branch<select name="branchId" defaultValue="">
          <option value="">All branches</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select></label>
        <label>Condition<select value={condition} onChange={event => setCondition(event.target.value)}>
          <option value="ALWAYS">Always hold</option>
          <option value="RESULT_SOURCE">Result source</option>
          <option value="ANY_ABNORMAL">Any abnormal flag</option>
          <option value="ANY_CRITICAL">Any critical value</option>
          <option value="DELTA_EXCEEDED">Delta limit exceeded</option>
        </select></label>
        {condition === "RESULT_SOURCE" && <label>Result source<select name="resultSource" defaultValue="MANUAL">
          <option value="MANUAL">Manual</option>
          <option value="ANALYZER">Analyzer</option>
          <option value="IMPORT">Import</option>
          <option value="CALCULATED">Calculated</option>
        </select></label>}
        <label>Severity<select name="severity" defaultValue="BLOCK">
          <option value="BLOCK">Block verification</option>
          <option value="WARNING">Warning only</option>
        </select></label>
        <label className="form-span">Reason (English)<input name="reasonEn" required /></label>
        <label className="form-span" dir="rtl">السبب بالعربية<input name="reasonAr" dir="rtl" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "hold"}>{busy === "hold" ? "Saving…" : "Create Validation Hold Rule"}</button>
      </form>
    </article>

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
