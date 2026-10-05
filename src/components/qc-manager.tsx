"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Analyzer = { id: string; code: string; name: string; branchId: string };
type Material = { id: string; code: string; nameEn: string; levelName: string };
type Lot = { id: string; materialId: string; lotNumber: string; label: string };
type Component = { id: string; code: string; nameEn: string };
type Test = { id: string; code: string; nameEn: string; components: Component[] };
type Target = {
  id: string;
  analyzerId: string;
  qcLotId: string;
  testId: string;
  componentId: string | null;
  label: string;
};
type Violation = {
  id: string;
  ruleCode: string;
  severity: string;
  analyzer: string;
  target: string;
};

export function QcManager({
  analyzers,
  materials,
  lots,
  tests,
  targets,
  openViolations,
  canManage,
  canEnter,
  canResolve,
}: {
  analyzers: Analyzer[];
  materials: Material[];
  lots: Lot[];
  tests: Test[];
  targets: Target[];
  openViolations: Violation[];
  canManage: boolean;
  canEnter: boolean;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [targetTestId, setTargetTestId] = useState("");
  const [runAnalyzerId, setRunAnalyzerId] = useState("");

  const selectedTest = useMemo(
    () => tests.find(test => test.id === targetTestId) || null,
    [tests, targetTestId],
  );

  async function submit(url: string, payload: unknown, key: string, success: string, form?: HTMLFormElement) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Action failed.");
    if (response.ok) {
      form?.reset();
      router.refresh();
    }
  }

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/qc/materials", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      manufacturer: form.get("manufacturer"),
      levelName: form.get("levelName"),
    }, "material", "QC material created.", event.currentTarget);
  }

  async function createLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/qc/lots", {
      materialId: form.get("materialId"),
      lotNumber: form.get("lotNumber"),
      receivedAt: form.get("receivedAt"),
      openedAt: form.get("openedAt"),
      expiryDate: form.get("expiryDate"),
    }, "lot", "QC lot created.", event.currentTarget);
  }

  async function createTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabledRules = ["1:2s","1:3s","2:2s","R:4s","4:1s","10x"]
      .filter(rule => form.get("rule-" + rule) === "on");

    await submit("/api/qc/targets", {
      qcLotId: form.get("qcLotId"),
      analyzerId: form.get("analyzerId"),
      testId: form.get("testId"),
      componentId: form.get("componentId"),
      targetMean: form.get("targetMean"),
      targetSd: form.get("targetSd"),
      targetCv: form.get("targetCv"),
      unitSnapshot: form.get("unitSnapshot"),
      qcValidHours: form.get("qcValidHours"),
      enabledRules,
      effectiveFrom: form.get("effectiveFrom"),
      effectiveTo: form.get("effectiveTo"),
    }, "target", "QC target created.", event.currentTarget);
    setTargetTestId("");
  }

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const runTargets = targets.filter(target => target.analyzerId === runAnalyzerId);
    const results = runTargets
      .map(target => ({
        targetId: target.id,
        observedValue: String(form.get("observed-" + target.id) || "").trim(),
      }))
      .filter(item => item.observedValue !== "");

    if (!runAnalyzerId || results.length === 0) {
      setMessage("Select an analyzer, then enter at least one observed QC value.");
      return;
    }

    await submit("/api/qc/runs", {
      analyzerId: runAnalyzerId,
      runAt: form.get("runAt"),
      notes: form.get("notes"),
      results,
    }, "run", "QC run evaluated.", event.currentTarget);
    setRunAnalyzerId("");
  }

  async function resolveViolation(violationId: string) {
    const actionType = window.prompt("Corrective action type: REPEAT_QC, RECALIBRATE, MAINTENANCE, REPLACE_REAGENT, REPLACE_CONTROL, INVESTIGATE, OTHER", "INVESTIGATE");
    if (!actionType) return;
    const description = window.prompt("Describe the corrective action performed:");
    if (!description?.trim()) return;
    const resolutionNote = window.prompt("Resolution note:");
    if (!resolutionNote?.trim()) return;

    await submit(`/api/qc/violations/${violationId}/resolve`, {
      actionType,
      description,
      resolutionNote,
    }, "resolve-" + violationId, "QC violation resolved.");
  }

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>QC Material</h2>
      <form className="catalog-form" onSubmit={createMaterial}>
        <label>Code<input name="code" required /></label>
        <label>Level<input name="levelName" placeholder="Level 1 / Normal" required /></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>Manufacturer<input name="manufacturer" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "material" ? "Saving…" : "Create QC Material"}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>QC Lot</h2>
      <form className="catalog-form" onSubmit={createLot}>
        <label className="form-span">Material<select name="materialId" required defaultValue="">
          <option value="">Select material…</option>
          {materials.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn} · {item.levelName}</option>)}
        </select></label>
        <label>Lot number<input name="lotNumber" required /></label>
        <label>Received<input name="receivedAt" type="date" /></label>
        <label>Opened<input name="openedAt" type="date" /></label>
        <label>Expiry<input name="expiryDate" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "lot" ? "Saving…" : "Create QC Lot"}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>QC Target & Westgard Rules</h2>
      <form className="catalog-form" onSubmit={createTarget}>
        <label>QC lot<select name="qcLotId" required defaultValue="">
          <option value="">Select lot…</option>
          {lots.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>Analyzer<select name="analyzerId" required defaultValue="">
          <option value="">Select analyzer…</option>
          {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </select></label>
        <label>Test<select name="testId" required value={targetTestId} onChange={event => setTargetTestId(event.target.value)}>
          <option value="">Select test…</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Component<select name="componentId" defaultValue="" disabled={!selectedTest || selectedTest.components.length === 0}>
          <option value="">{selectedTest?.components.length ? "Select component…" : "Simple test result"}</option>
          {(selectedTest?.components || []).map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}
        </select></label>
        <label>Target mean<input name="targetMean" inputMode="decimal" required /></label>
        <label>Target SD<input name="targetSd" inputMode="decimal" required /></label>
        <label>Target CV %<input name="targetCv" inputMode="decimal" /></label>
        <label>Unit<input name="unitSnapshot" /></label>
        <label>QC valid hours<input name="qcValidHours" type="number" min="1" max="168" defaultValue="24" required /></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <div className="form-span">
          <strong>Westgard rules</strong>
          <div className="result-actions">
            {["1:2s","1:3s","2:2s","R:4s","4:1s","10x"].map(rule => <label className="check-line" key={rule}>
              <input type="checkbox" name={"rule-" + rule} defaultChecked={rule !== "10x"} /> {rule}
            </label>)}
          </div>
        </div>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "target" ? "Saving…" : "Create QC Target"}</button>
      </form>
    </article>}

    {canEnter && <article className="detail-card">
      <h2>Enter QC Run</h2>
      <p className="muted">Enter multiple control levels in the same run when available so multi-level rules such as R:4s are evaluated within the same QC event.</p>
      <form className="catalog-form" onSubmit={createRun}>
        <label>Analyzer<select required value={runAnalyzerId} onChange={event => setRunAnalyzerId(event.target.value)}>
          <option value="">Select analyzer…</option>
          {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </select></label>
        <label>Run at<input name="runAt" type="datetime-local" /></label>
        <div className="form-span result-field-list">
          {targets.filter(target => target.analyzerId === runAnalyzerId).map(target =>
            <label className="result-field-row" key={target.id}>
              <span>{target.label}</span>
              <input name={"observed-" + target.id} inputMode="decimal" placeholder="Observed value" />
            </label>
          )}
          {runAnalyzerId && !targets.some(target => target.analyzerId === runAnalyzerId) &&
            <p className="muted">No active QC targets for this analyzer.</p>}
        </div>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "run" ? "Evaluating…" : "Save & Evaluate QC"}</button>
      </form>
    </article>}

    {openViolations.length > 0 && <article className="detail-card">
      <h2>Open QC Violations</h2>
      <div className="reflex-list">
        {openViolations.map(item => <div className="reflex-card" key={item.id}>
          <div>
            <span className="eyebrow">{item.severity}</span>
            <strong>{item.ruleCode} · {item.target}</strong>
            <small>{item.analyzer}</small>
          </div>
          {canResolve && <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void resolveViolation(item.id)}>
            {busy === "resolve-" + item.id ? "Resolving…" : "Resolve"}
          </button>}
        </div>)}
      </div>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
