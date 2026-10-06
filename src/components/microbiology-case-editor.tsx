"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type OrganismOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type AntibioticOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
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
  locale,
}: {
  caseId: string;
  cultureStatus: string;
  preliminaryComment: string;
  organisms: OrganismOption[];
  antibiotics: AntibioticOption[];
  isolates: IsolateOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
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
      setMessage(body.error || tr("The microbiology action could not be saved.", "تعذر حفظ إجراء الأحياء الدقيقة."));
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
    if (result) setMessage(tr("Culture status updated.", "تم تحديث حالة الزرع."));
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
      setMessage(tr("Observation added.", "تمت إضافة الملاحظة."));
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
      setMessage(tr("Isolate added.", "تمت إضافة العزلة."));
    }
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  }

  async function addSusceptibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIsolateId) {
      setMessage(tr("Select an isolate first.", "اختر عزلة أولًا."));
      return;
    }
    const form = new FormData(event.currentTarget);
    const activeRows = rows.filter(row => row.antibioticId);
    if (activeRows.length === 0) {
      setMessage(tr("Add at least one antibiotic result.", "أضف نتيجة مضاد حيوي واحدة على الأقل."));
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
      setMessage(tr("Susceptibility panel recorded.", "تم تسجيل لوحة الحساسية."));
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Culture Status", "حالة الزرع")}</h2>
      <form className="catalog-form" onSubmit={updateCulture}>
        <label>{tr("Status", "الحالة")}<select name="cultureStatus" defaultValue={cultureStatus}>
          <option value="PENDING">{tr("Pending", "قيد الانتظار")}</option>
          <option value="NO_GROWTH">{tr("No growth", "لا يوجد نمو")}</option>
          <option value="GROWTH">{tr("Growth", "نمو")}</option>
          <option value="MIXED_GROWTH">{tr("Mixed growth", "نمو مختلط")}</option>
          <option value="CONTAMINATED">{tr("Contaminated", "ملوث")}</option>
        </select></label>
        <label className="form-span">{tr("Preliminary comment", "تعليق أولي")}<textarea name="preliminaryComment" rows={3} defaultValue={preliminaryComment} /></label>
        <label className="check-line form-span"><input type="checkbox" name="markPreliminary" /> {tr("Mark case as PRELIMINARY", "تعيين الحالة كأولية")}</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "culture" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Culture Status", "حفظ حالة الزرع")}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>{tr("Add Observation", "إضافة ملاحظة")}</h2>
      <form className="catalog-form" onSubmit={addObservation}>
        <label>{tr("Type", "النوع")}<select name="observationType" defaultValue="GRAM_STAIN">
          <option value="GRAM_STAIN">{tr("Gram stain", "صبغة غرام")}</option>
          <option value="MICROSCOPY">{tr("Microscopy", "فحص مجهري")}</option>
          <option value="CULTURE">{tr("Culture observation", "ملاحظة زرع")}</option>
          <option value="COLONY_COUNT">{tr("Colony count", "عدد المستعمرات")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label className="form-span">{tr("Observation", "الملاحظة")}<textarea name="observationText" rows={4} required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "observation" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Observation", "إضافة الملاحظة")}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>{tr("Add Isolate", "إضافة عزلة")}</h2>
      <form className="catalog-form" onSubmit={addIsolate}>
        <label>{tr("Organism", "الكائن الدقيق")}<select name="organismId" required defaultValue="">
          <option value="">{tr("Select organism…", "اختر الكائن الدقيق…")}</option>
          {organisms.map(item => <option key={item.id} value={item.id}>{item.code} — {locale === "ar" ? item.nameAr || item.nameEn : item.nameEn}</option>)}
        </select></label>
        <label>{tr("Quantity / growth", "الكمية / النمو")}<input name="quantityText" placeholder="e.g. Heavy growth / 10^5 CFU/mL" /></label>
        <label className="form-span">{tr("Colony notes", "ملاحظات المستعمرات")}<textarea name="colonyNotes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || organisms.length === 0}>{busy === "isolate" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Isolate", "إضافة العزلة")}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>{tr("Susceptibility Panel", "لوحة الحساسية")}</h2>
      <form className="catalog-form" onSubmit={addSusceptibility}>
        <label>{tr("Isolate", "العزلة")}<select value={selectedIsolateId} onChange={event => setSelectedIsolateId(event.target.value)} required>
          <option value="">{tr("Select isolate…", "اختر العزلة…")}</option>
          {isolates.map(item => <option key={item.id} value={item.id}>#{item.sequenceNumber} · {item.organismCode} — {item.organismName}</option>)}
        </select></label>
        <label>{tr("Method", "الطريقة")}<input name="method" placeholder="Disk diffusion / MIC / automated" /></label>

        <div className="form-span">
          {rows.map(row => <div className="catalog-form" key={row.key}>
            <label>{tr("Antibiotic", "المضاد الحيوي")}<select value={row.antibioticId} onChange={event => updateRow(row.key, { antibioticId: event.target.value })}>
              <option value="">{tr("Select antibiotic…", "اختر المضاد الحيوي…")}</option>
              {antibiotics.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
            </select></label>
            <label>{tr("Interpretation", "التفسير")}<select value={row.interpretation} onChange={event => updateRow(row.key, { interpretation: event.target.value as Row["interpretation"] })}>
              <option value="S">S</option><option value="I">I</option><option value="R">R</option><option value="NON_SUSCEPTIBLE">{tr("Non-susceptible", "غير حساس")}</option><option value="UNKNOWN">{tr("Unknown", "غير معروف")}</option>
            </select></label>
            <label>MIC<input inputMode="decimal" value={row.micValue} onChange={event => updateRow(row.key, { micValue: event.target.value })} /></label>
            <label>{tr("MIC unit", "وحدة MIC")}<input value={row.micUnit} onChange={event => updateRow(row.key, { micUnit: event.target.value })} /></label>
            <label>{tr("Zone (mm)", "القطر (مم)")}<input inputMode="decimal" value={row.zoneDiameterMm} onChange={event => updateRow(row.key, { zoneDiameterMm: event.target.value })} /></label>
            <label>{tr("Breakpoint snapshot", "حد التفسير المحفوظ")}<input value={row.breakpointSnapshot} onChange={event => updateRow(row.key, { breakpointSnapshot: event.target.value })} /></label>
            {rows.length > 1 && <button className="secondary-button form-span" type="button" onClick={() => setRows(current => current.filter(item => item.key !== row.key))}>{tr("Remove Row", "حذف الصف")}</button>}
          </div>)}
          <button className="secondary-button" type="button" onClick={() => setRows(current => [...current, emptyRow(Math.max(...current.map(item => item.key), 0) + 1)])}>{tr("Add Antibiotic Row", "إضافة مضاد حيوي")}</button>
        </div>

        <label className="form-span">{tr("Comments", "التعليقات")}<textarea name="comments" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || isolates.length === 0 || antibiotics.length === 0}>{busy === "susceptibility" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Susceptibility Panel", "حفظ لوحة الحساسية")}</button>
      </form>
    </article>

    {message && <p className="form-success form-span">{message}</p>}
  </section>;
}
