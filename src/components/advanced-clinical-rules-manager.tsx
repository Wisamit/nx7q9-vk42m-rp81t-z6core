"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type ComponentOption = { id: string; code: string; nameEn: string; resultType: string };
type TestOption = { id: string; code: string; nameEn: string; resultType: string; components: ComponentOption[] };

export function AdvancedClinicalRulesManager({
  tests,
  branches,
}: {
  tests: TestOption[];
  branches: Branch[];
}) {
  const router = useRouter();
  const [calcTestId, setCalcTestId] = useState("");
  const [reflexSourceTestId, setReflexSourceTestId] = useState("");
  const [reflexSourceComponentId, setReflexSourceComponentId] = useState("");
  const [reflexTargetTestId, setReflexTargetTestId] = useState("");
  const [operator, setOperator] = useState("GT");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const calcComponents = useMemo(() => tests.find(test => test.id === calcTestId)?.components || [], [tests, calcTestId]);
  const sourceTest = useMemo(() => tests.find(test => test.id === reflexSourceTestId) || null, [tests, reflexSourceTestId]);
  const sourceComponents = sourceTest?.components || [];
  const sourceComponent = sourceComponents.find(component => component.id === reflexSourceComponentId) || null;
  const sourceResultType = sourceComponent?.resultType || (sourceComponents.length === 0 ? sourceTest?.resultType : null);
  const numericOperator = ["LT","LTE","GT","GTE"].includes(operator)
    || (["EQ","NE"].includes(operator) && sourceResultType === "NUMERIC");

  async function createCalculated(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("calculated"); setMessage("");

    const response = await fetch("/api/clinical-rules/calculated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        targetComponentId: form.get("targetComponentId"),
        expression: form.get("expression"),
        decimalPrecision: form.get("decimalPrecision"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Calculated result rule created." : body.error || "Could not create calculated result rule.");
    setBusy("");
    if (response.ok) { event.currentTarget.reset(); setCalcTestId(""); router.refresh(); }
  }

  async function createReflex(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("reflex"); setMessage("");

    const response = await fetch("/api/clinical-rules/reflex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceTestId: form.get("sourceTestId"),
        sourceComponentId: form.get("sourceComponentId"),
        branchId: form.get("branchId"),
        operator,
        numericThreshold: form.get("numericThreshold"),
        textThreshold: form.get("textThreshold"),
        targetTestId: form.get("targetTestId"),
        noteEn: form.get("noteEn"),
        noteAr: form.get("noteAr"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Reflex recommendation rule created." : body.error || "Could not create reflex rule.");
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      setReflexSourceTestId("");
      setReflexSourceComponentId("");
      setReflexTargetTestId("");
      setOperator("GT");
      router.refresh();
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>Create Calculated Result Rule</h2>
      <p className="muted">Uses a restricted arithmetic expression. Component codes are variables; arbitrary code execution is not allowed.</p>
      <form className="catalog-form" onSubmit={createCalculated}>
        <label>Test<select name="testId" required value={calcTestId} onChange={event => setCalcTestId(event.target.value)}>
          <option value="">Select test…</option>
          {tests.filter(test => test.components.length > 1).map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Target component<select name="targetComponentId" required defaultValue="" disabled={!calcTestId}>
          <option value="">Select calculated target…</option>
          {calcComponents.filter(component => component.resultType === "NUMERIC").map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}
        </select></label>
        <label className="form-span">Formula<input name="expression" required placeholder="Example: TC - HDL - (TG / 5)" /></label>
        <p className="muted form-span">Available component codes: {calcComponents.map(component => component.code).join(", ") || "Select a test first."}</p>
        <label>Decimal precision<input name="decimalPrecision" type="number" min="0" max="12" defaultValue="2" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "calculated"}>{busy === "calculated" ? "Saving…" : "Create Calculated Rule"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Reflex Recommendation Rule</h2>
      <p className="muted">A matching result creates a recommendation for review. It does not automatically add or bill a new test.</p>
      <form className="catalog-form" onSubmit={createReflex}>
        <label>Source test<select name="sourceTestId" required value={reflexSourceTestId} onChange={event => {
          setReflexSourceTestId(event.target.value);
          setReflexSourceComponentId("");
        }}>
          <option value="">Select source…</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Source component<select name="sourceComponentId" value={reflexSourceComponentId} onChange={event => setReflexSourceComponentId(event.target.value)} disabled={!reflexSourceTestId || sourceComponents.length === 0}>
          <option value="">{sourceComponents.length ? "Select component…" : "Simple test result"}</option>
          {sourceComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}
        </select></label>
        <label>Branch<select name="branchId" defaultValue=""><option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Operator<select value={operator} onChange={event => setOperator(event.target.value)}>
          <option value="GT">Greater than</option><option value="GTE">Greater than or equal</option><option value="LT">Less than</option><option value="LTE">Less than or equal</option><option value="EQ">Equals</option><option value="NE">Not equal</option><option value="CONTAINS">Contains text</option>
        </select></label>
        {numericOperator ? <label>Numeric threshold<input name="numericThreshold" type="number" step="0.00000001" required /></label> :
          <label>Threshold / text<input name="textThreshold" required /></label>}
        <label>Recommended test<select name="targetTestId" required value={reflexTargetTestId} onChange={event => setReflexTargetTestId(event.target.value)}>
          <option value="">Select recommended test…</option>
          {tests.filter(test => test.id !== reflexSourceTestId).map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label className="form-span">Note (English)<textarea name="noteEn" rows={2} /></label>
        <label className="form-span" dir="rtl">الملاحظة بالعربية<textarea name="noteAr" rows={2} dir="rtl" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "reflex"}>{busy === "reflex" ? "Saving…" : "Create Reflex Rule"}</button>
      </form>
    </article>
    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
