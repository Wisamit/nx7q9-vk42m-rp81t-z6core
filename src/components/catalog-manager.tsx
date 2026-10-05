"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; code: string; nameEn?: string | null; symbol?: string };

export function CatalogManager({ departments, specimens, containers, methods, units }: { departments: Option[]; specimens: Option[]; containers: Option[]; methods: Option[]; units: Option[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"test" | "master" | null>(null);
  const [masterType, setMasterType] = useState("departments");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...data, decimalPrecision: data.decimalPrecision ? Number(data.decimalPrecision) : null, tatMinutes: data.tatMinutes ? Number(data.tatMinutes) : null };
    const response = await fetch("/api/catalog/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) { setMode(null); router.refresh(); } else setMessage("Could not create the test. Check the code and required fields.");
    setSaving(false);
  }

  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/catalog/master-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, type: masterType }) });
    if (response.ok) { setMode(null); router.refresh(); } else setMessage("Could not create the item. The code may already exist.");
    setSaving(false);
  }

  return <div className="catalog-actions">
    <button className="secondary-button" onClick={() => { setMode("master"); setMessage(""); }}>Add Master Data</button>
    <button className="primary-button" onClick={() => { setMode("test"); setMessage(""); }}>Add Test</button>
    {mode && <div className="modal-backdrop" onMouseDown={() => setMode(null)}><section className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Test Catalog</p><h2>{mode === "test" ? "Create Test" : "Add Master Data"}</h2></div><button className="icon-button" onClick={() => setMode(null)}>×</button></div>
      {mode === "test" ? <form className="catalog-form" onSubmit={saveTest}>
        <label>Test code<input name="code" required placeholder="e.g. GLU" /></label>
        <label>English name<input name="nameEn" required placeholder="e.g. Glucose" /></label>
        <label>Arabic name<input name="nameAr" dir="rtl" /></label>
        <label>Abbreviation<input name="abbreviation" /></label>
        <label>Result type<select name="resultType" defaultValue="NUMERIC"><option>NUMERIC</option><option>TEXT</option><option>QUALITATIVE</option><option>BOOLEAN</option><option>DATE</option></select></label>
        <label>Workflow<select name="workflowType" defaultValue="GENERAL"><option value="GENERAL">General laboratory</option><option value="MICROBIOLOGY">Microbiology / culture</option></select></label>
        <label>Department<select name="departmentId"><option value="">—</option>{departments.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>Specimen<select name="specimenTypeId"><option value="">—</option>{specimens.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>Container / tube<select name="containerId"><option value="">—</option>{containers.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>Method<select name="methodId"><option value="">—</option>{methods.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>Default unit<select name="defaultUnitId"><option value="">—</option>{units.map(x => <option key={x.id} value={x.id}>{x.symbol || x.code}</option>)}</select></label>
        <label>Decimal precision<input name="decimalPrecision" type="number" min="0" max="8" /></label>
        <label>TAT minutes<input name="tatMinutes" type="number" min="0" /></label>
        <label>LOINC code<input name="loincCode" /></label>
        {message && <p className="form-error form-span">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? "Saving…" : "Create Test"}</button>
      </form> : <form className="catalog-form" onSubmit={saveMaster}>
        <label>Type<select value={masterType} onChange={e => setMasterType(e.target.value)}><option value="departments">Department</option><option value="specimens">Specimen Type</option><option value="containers">Container / Tube</option><option value="methods">Method</option><option value="units">Unit</option></select></label>
        <label>Code<input name="code" required /></label><label>English name<input name="nameEn" required /></label><label>Arabic name<input name="nameAr" dir="rtl" /></label>
        {masterType === "units" && <><label>Symbol<input name="symbol" required /></label><label>UCUM code<input name="ucumCode" /></label></>}
        {masterType === "containers" && <><label>Tube color<input name="tubeColor" /></label><label>Additive<input name="additive" /></label></>}
        {message && <p className="form-error form-span">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? "Saving…" : "Add Item"}</button>
      </form>}
    </section></div>}
  </div>;
}
