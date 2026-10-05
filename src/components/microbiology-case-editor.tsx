"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type OrganismOption = { id: string; code: string; nameEn: string };
type AntibioticOption = { id: string; code: string; nameEn: string };
type IsolateOption = { id: string; sequenceNumber: number; organismCode: string; organismName: string };

type Row = {
  key: number;
  antibioticId: string;
  interpretation: "S" | "I" | "R" | "NON_SUSCEPTIBLE" | "UNKNOWN";
  micValue: string;
  micUnit: string;
  zoneDiameterMm: string;
  breakpointSnapshot: string;
};

function emptyRow(key: number): Row {
  return { key, antibioticId: "", interpretation: "UNKNOWN", micValue: "", micUnit: "", zoneDiameterMm: "", breakpointSnapshot: "" };
}

export function MicrobiologyCaseEditor({
  caseId,
  cultureStatus,
  preliminaryComment,
  organisms,
  antibiotics,
  isolates,
}: {
  caseId: string;
  cultureStatus: string;
  preliminaryComment: string;
  organisms: OrganismOption[];
  antibiotics: AntibioticOption[];
  isolates: IsolateOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selectedIsolateId, setSelectedIsolateId] = useState(isolates[0]?.id || "");
  const [rows, setRows] = useState<Row[]>([emptyRow(1)]);

  async function postJson(url: string, payload: unknown, busyKey: string) {
    setBusy(busyKey);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setMessage(body.error || "The microbiology action could not be saved.");
      return null;
    }
    router.refresh();
    return body;
  }

  async function updateCulture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/microbiology/cases/" + caseId, {
      cultureStatus: form.get("cultureStatus"),
      preliminaryComment: form.get("preliminaryComment"),
      markPreliminary: form.get("markPreliminary") === "on",
    }, "culture");
    if (result) setMessage("Culture status updated.");
  }

  async function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/microbiology/cases/" + caseId + "/observations", {
      observationType: form.get("observationType"),
      observationText: form.get("observationText"),
    }, "observation");
    if (result) {
      event.currentTarget.reset();
      setMessage("Observation added.");
    }
  }

  async function addIsolate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/microbiology/cases/" + caseId + "/isolates", {
      organismId: form.get("organismId"),
      quantityText: form.get("quantityText"),
      colonyNotes: form.get("colonyNotes"),
    }, "isolate");
    if (result) {
      event.currentTarget.reset();
      setMessage("Isolate added.");
    }
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  }

  async function addSusceptibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIsolateId) {
      setMessage("Select an isolate first.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const activeRows = rows.filter(row => row.antibioticId);
    if (activeRows.length === 0) {
      setMessage("Add at least one antibiotic result.");
      return;
    }

    const result = await postJson("/api/microbiology/isolates/" + selectedIsolateId + "/susceptibility", {
      method: form.get("method"),
      comments: form.get("comments"),
      results: activeRows.map(row => ({
        antibioticId: row.antibioticId,
        interpretation: row.interpretation,
        micValue: row.micValue || null,
        micUnit: row.micUnit,
        zoneDiameterMm: row.zoneDiameterMm || null,
        breakpointSnapshot: row.breakpointSnapshot,
      })),
    }, "susceptibility");
    if (result) {
      setRows([emptyRow(1)]);
      event.currentTarget.reset();
      setMessage("Susceptibility panel recorded.");
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>Culture Status</h2>
      <form className="catalog-form" onSubmit={updateCulture}>
        <label>Status<select name="cultureStatus" defaultValue={cultureStatus}>
          <option value="PENDING">Pending</option>
          <option value="NO_GROWTH">No growth</option>
          <option value="GROWTH">Growth</option>
          <option value="MIXED_GROWTH">Mixed growth</option>
          <option value="CONTAMINATED">Contaminated</option>
        </select></label>
        <label className="form-span">Preliminary comment<textarea name="preliminaryComment" rows={3} defaultValue={preliminaryComment} /></label>
        <label className="check-line form-span"><input type="checkbox" name="markPreliminary" /> Mark case as PRELIMINARY</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "culture" ? "Saving…" : "Save Culture Status"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Add Observation</h2>
      <form className="catalog-form" onSubmit={addObservation}>
        <label>Type<select name="observationType" defaultValue="GRAM_STAIN">
          <option value="GRAM_STAIN">Gram stain</option>
          <option value="MICROSCOPY">Microscopy</option>
          <option value="CULTURE">Culture observation</option>
          <option value="COLONY_COUNT">Colony count</option>
          <option value="OTHER">Other</option>
        </select></label>
        <label className="form-span">Observation<textarea name="observationText" rows={4} required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "observation" ? "Saving…" : "Add Observation"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Add Isolate</h2>
      <form className="catalog-form" onSubmit={addIsolate}>
        <label>Organism<select name="organismId" required defaultValue="">
          <option value="">Select organism…</option>
          {organisms.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
        </select></label>
        <label>Quantity / growth<input name="quantityText" placeholder="e.g. Heavy growth / 10^5 CFU/mL" /></label>
        <label className="form-span">Colony notes<textarea name="colonyNotes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || organisms.length === 0}>{busy === "isolate" ? "Saving…" : "Add Isolate"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Susceptibility Panel</h2>
      <form className="catalog-form" onSubmit={addSusceptibility}>
        <label>Isolate<select value={selectedIsolateId} onChange={event => setSelectedIsolateId(event.target.value)} required>
          <option value="">Select isolate…</option>
          {isolates.map(item => <option key={item.id} value={item.id}>#{item.sequenceNumber} · {item.organismCode} — {item.organismName}</option>)}
        </select></label>
        <label>Method<input name="method" placeholder="Disk diffusion / MIC / automated" /></label>

        <div className="form-span">
          {rows.map(row => <div className="catalog-form" key={row.key}>
            <label>Antibiotic<select value={row.antibioticId} onChange={event => updateRow(row.key, { antibioticId: event.target.value })}>
              <option value="">Select antibiotic…</option>
              {antibiotics.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
            </select></label>
            <label>Interpretation<select value={row.interpretation} onChange={event => updateRow(row.key, { interpretation: event.target.value as Row["interpretation"] })}>
              <option value="S">S</option><option value="I">I</option><option value="R">R</option><option value="NON_SUSCEPTIBLE">Non-susceptible</option><option value="UNKNOWN">Unknown</option>
            </select></label>
            <label>MIC<input inputMode="decimal" value={row.micValue} onChange={event => updateRow(row.key, { micValue: event.target.value })} /></label>
            <label>MIC unit<input value={row.micUnit} onChange={event => updateRow(row.key, { micUnit: event.target.value })} /></label>
            <label>Zone (mm)<input inputMode="decimal" value={row.zoneDiameterMm} onChange={event => updateRow(row.key, { zoneDiameterMm: event.target.value })} /></label>
            <label>Breakpoint snapshot<input value={row.breakpointSnapshot} onChange={event => updateRow(row.key, { breakpointSnapshot: event.target.value })} /></label>
            {rows.length > 1 && <button className="secondary-button form-span" type="button" onClick={() => setRows(current => current.filter(item => item.key !== row.key))}>Remove Row</button>}
          </div>)}
          <button className="secondary-button" type="button" onClick={() => setRows(current => [...current, emptyRow(Math.max(...current.map(item => item.key), 0) + 1)])}>Add Antibiotic Row</button>
        </div>

        <label className="form-span">Comments<textarea name="comments" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || isolates.length === 0 || antibiotics.length === 0}>{busy === "susceptibility" ? "Saving…" : "Save Susceptibility Panel"}</button>
      </form>
    </article>

    {message && <p className="form-success form-span">{message}</p>}
  </section>;
}
