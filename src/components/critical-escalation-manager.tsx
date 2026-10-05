"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; code: string; nameEn: string };
type Branch = { id: string; code: string; nameEn: string };

export function CriticalEscalationManager({
  tests,
  branches,
}: {
  tests: Option[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/clinical-rules/critical-escalation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        branchId: form.get("branchId"),
        acknowledgementMinutes: form.get("acknowledgementMinutes"),
        escalationIntervalMinutes: form.get("escalationIntervalMinutes"),
        maxEscalationLevel: form.get("maxEscalationLevel"),
        requireReadBack: form.get("requireReadBack") === "on",
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Critical escalation policy created." : body.error || "Could not create critical escalation policy.");
    setBusy(false);
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  return <section className="detail-card detail-section">
    <h2>Create Critical Escalation Policy</h2>
    <p className="muted">Controls acknowledgement deadline, escalation cadence, maximum escalation level and mandatory read-back for critical results.</p>
    <form className="catalog-form" onSubmit={submit}>
      <label>Test<select name="testId" required defaultValue="">
        <option value="">Select test…</option>
        {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
      </select></label>
      <label>Branch<select name="branchId" defaultValue="">
        <option value="">All branches</option>
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
      </select></label>
      <label>Acknowledgement deadline (minutes)<input name="acknowledgementMinutes" type="number" min="1" max="1440" defaultValue="30" required /></label>
      <label>Escalation interval (minutes)<input name="escalationIntervalMinutes" type="number" min="1" max="1440" defaultValue="15" required /></label>
      <label>Maximum escalation level<input name="maxEscalationLevel" type="number" min="1" max="10" defaultValue="3" required /></label>
      <label className="check-line"><input name="requireReadBack" type="checkbox" defaultChecked /> Require read-back on acknowledgement</label>
      <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
      <label>Effective to<input name="effectiveTo" type="date" /></label>
      <button className="primary-button form-span" disabled={busy}>{busy ? "Saving…" : "Create Critical Escalation Policy"}</button>
    </form>
    {message && <p className="form-success">{message}</p>}
  </section>;
}
