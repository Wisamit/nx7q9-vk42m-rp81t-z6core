"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PatientOption = { id: string; patientNumber: string; fullNameEn: string; phone: string | null };
type TestOption = { id: string; code: string; nameEn: string };
type SimpleOption = { id: string; code: string; nameEn: string };
type ReferrerOption = SimpleOption & { clientId: string | null };
type BranchOption = SimpleOption;

export function OrderCreateForm({
  patients,
  tests,
  clients,
  referrers,
  branches,
  activeBranchId,
}: {
  patients: PatientOption[];
  tests: TestOption[];
  clients: SimpleOption[];
  referrers: ReferrerOption[];
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [testSearch, setTestSearch] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const patientOptions = useMemo(() => patients.map(p => ({
    ...p,
    label: `${p.patientNumber} — ${p.fullNameEn}${p.phone ? ` — ${p.phone}` : ""}`,
  })), [patients]);

  const testOptions = useMemo(() => tests.map(t => ({ ...t, label: `${t.code} — ${t.nameEn}` })), [tests]);
  const selectedTests = selectedTestIds.map(id => tests.find(t => t.id === id)).filter((x): x is TestOption => Boolean(x));

  function addTest() {
    const match = testOptions.find(t => t.label === testSearch);
    if (!match) {
      setMessage("Select a valid test from the search suggestions.");
      return;
    }
    setSelectedTestIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setTestSearch("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) { setMessage("Select a valid patient."); return; }
    if (selectedTestIds.length === 0) { setMessage("Add at least one test."); return; }

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const fastingValue = form.get("fasting");
    const fasting = fastingValue === "YES" ? true : fastingValue === "NO" ? false : null;

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: form.get("branchId"),
        patientId,
        referrerId: form.get("referrerId"),
        clientId: form.get("clientId"),
        priority: form.get("priority"),
        fasting,
        diagnosis: form.get("diagnosis"),
        clinicalNotes: form.get("clinicalNotes"),
        pregnancyInfo: form.get("pregnancyInfo"),
        testIds: selectedTestIds,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Order ${body.accessionNumber} created · Invoice ${body.invoiceNumber} · ${body.total} ${body.currency}`);
      setPatientId("");
      setPatientSearch("");
      setSelectedTestIds([]);
      event.currentTarget.reset();
      router.refresh();
    } else if (body.error === "missing_prices") {
      const codes = Array.isArray(body.tests) ? body.tests.map((x: { code?: string }) => x.code).filter(Boolean).join(", ") : "";
      setMessage(`Missing active prices for: ${codes || "selected tests"}. Configure Pricing first.`);
    } else if (body.error === "mixed_currencies_not_allowed") {
      setMessage("Selected tests resolve to different currencies. One order invoice must use a single currency.");
    } else {
      setMessage(body.error || "Could not create order.");
    }
    setBusy(false);
  }

  return <form className="order-form" onSubmit={submit}>
    <div className="form-grid">
      <label>Ordering branch
        <select name="branchId" required defaultValue={activeBranchId || ""}>
          <option value="">Select branch…</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select>
      </label>
      <label>Priority
        <select name="priority" defaultValue="ROUTINE"><option>ROUTINE</option><option>URGENT</option><option>STAT</option></select>
      </label>

      <label className="form-span">Patient
        <input
          list="order-patient-options"
          placeholder="Patient #, name or phone…"
          value={patientSearch}
          onChange={e => {
            const value = e.target.value;
            setPatientSearch(value);
            const match = patientOptions.find(p => p.label === value);
            setPatientId(match?.id || "");
          }}
          required
        />
        <datalist id="order-patient-options">{patientOptions.map(p => <option key={p.id} value={p.label} />)}</datalist>
      </label>

      <label>Referrer
        <select name="referrerId" defaultValue="">
          <option value="">No referrer</option>
          {referrers.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}
        </select>
      </label>
      <label>Billing client
        <select name="clientId" defaultValue="">
          <option value="">Patient / default billing</option>
          {clients.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}
        </select>
      </label>

      <label>Fasting
        <select name="fasting" defaultValue=""><option value="">Unknown / not stated</option><option value="YES">Yes</option><option value="NO">No</option></select>
      </label>
      <label>Diagnosis / indication<input name="diagnosis" maxLength={500} /></label>
      <label className="form-span">Pregnancy information<input name="pregnancyInfo" maxLength={500} /></label>
      <label className="form-span">Clinical notes<textarea name="clinicalNotes" rows={3} /></label>

      <div className="form-span order-test-picker">
        <label>Tests
          <div className="inline-search">
            <input
              list="order-test-options"
              placeholder="Type test code or name…"
              value={testSearch}
              onChange={e => setTestSearch(e.target.value)}
            />
            <button className="secondary-button" type="button" onClick={addTest}>Add Test</button>
          </div>
          <datalist id="order-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <div className="selected-test-list">
          {selectedTests.length === 0 ? <span className="muted">No tests selected.</span> :
            selectedTests.map(test => <span className="selected-test-chip" key={test.id}>{test.code} — {test.nameEn}<button type="button" onClick={() => setSelectedTestIds(ids => ids.filter(id => id !== test.id))}>×</button></span>)
          }
        </div>
      </div>

      {message && <div className="form-success form-span">{message}</div>}
      <button className="primary-button form-span" disabled={busy}>{busy ? "Creating order…" : "Register Order & Invoice"}</button>
    </div>
  </form>;
}
