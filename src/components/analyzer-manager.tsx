"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type Department = { id: string; code: string; nameEn: string; branchId: string | null };
type TestOption = { id: string; code: string; nameEn: string; components: Array<{ id: string; code: string; nameEn: string }> };
type AnalyzerOption = { id: string; code: string; name: string; branchId: string };

export function AnalyzerManager({
  branches,
  departments,
  tests,
  analyzers,
}: {
  branches: Branch[];
  departments: Department[];
  tests: TestOption[];
  analyzers: AnalyzerOption[];
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [mappingTestId, setMappingTestId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [issuedToken, setIssuedToken] = useState("");

  const branchDepartments = useMemo(
    () => departments.filter(item => !item.branchId || item.branchId === branchId),
    [departments, branchId],
  );
  const mappingComponents = tests.find(test => test.id === mappingTestId)?.components || [];

  async function post(url: string, payload: unknown, key: string) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setMessage(body.error || "Analyzer configuration could not be saved.");
      return null;
    }
    router.refresh();
    return body;
  }

  async function createAnalyzer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = await post("/api/analyzers", {
      branchId: form.get("branchId"),
      departmentId: form.get("departmentId"),
      code: form.get("code"),
      name: form.get("name"),
      manufacturer: form.get("manufacturer"),
      model: form.get("model"),
      serialNumber: form.get("serialNumber"),
      protocol: form.get("protocol"),
      transport: form.get("transport"),
      bridgeDeviceKey: form.get("bridgeDeviceKey"),
    }, "analyzer");
    if (body) {
      event.currentTarget.reset();
      setMessage("Analyzer created.");
    }
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const analyzerId = String(form.get("analyzerId") || "");
    if (!analyzerId) return;
    const body = await post(`/api/analyzers/${analyzerId}/credentials`, {
      name: form.get("name"),
      expiresAt: form.get("expiresAt"),
    }, "credential");
    if (body) {
      setIssuedToken(body.token || "");
      setMessage("Bridge credential created. Copy the token now; it will not be shown again.");
      event.currentTarget.reset();
    }
  }

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const analyzerId = String(form.get("analyzerId") || "");
    if (!analyzerId) return;
    const body = await post(`/api/analyzers/${analyzerId}/mappings`, {
      analyzerTestCode: form.get("analyzerTestCode"),
      analyzerUnitCode: form.get("analyzerUnitCode"),
      testId: form.get("testId"),
      componentId: form.get("componentId"),
      effectiveFrom: form.get("effectiveFrom"),
      effectiveTo: form.get("effectiveTo"),
    }, "mapping");
    if (body) {
      event.currentTarget.reset();
      setMappingTestId("");
      setMessage("Analyzer test mapping created.");
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>Register Analyzer</h2>
      <p className="muted">Connection handling stays in the external Analyzer Bridge. The LIS stores identity, protocol and routing metadata only.</p>
      <form className="catalog-form" onSubmit={createAnalyzer}>
        <label>Branch<select name="branchId" required value={branchId} onChange={event => setBranchId(event.target.value)}>
          {branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
        </select></label>
        <label>Department<select name="departmentId" defaultValue="">
          <option value="">Unassigned</option>
          {branchDepartments.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
        </select></label>
        <label>Code<input name="code" required maxLength={80} /></label>
        <label>Name<input name="name" required maxLength={200} /></label>
        <label>Manufacturer<input name="manufacturer" maxLength={150} /></label>
        <label>Model<input name="model" maxLength={150} /></label>
        <label>Serial number<input name="serialNumber" maxLength={150} /></label>
        <label>Protocol<select name="protocol" defaultValue="ASTM"><option>ASTM</option><option value="HL7_V2">HL7 v2</option><option>FILE</option><option>CSV</option><option>HTTP</option></select></label>
        <label>Transport<select name="transport" defaultValue="SERIAL"><option>SERIAL</option><option>TCP_CLIENT</option><option>TCP_SERVER</option><option>WATCH_FOLDER</option><option>HTTP</option></select></label>
        <label>Bridge device key<input name="bridgeDeviceKey" maxLength={150} placeholder="Local bridge identifier" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "analyzer" ? "Saving…" : "Register Analyzer"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Issue Bridge Credential</h2>
      <p className="muted">The raw token is shown once. Only its SHA-256 hash is stored in the LIS.</p>
      <form className="catalog-form" onSubmit={createCredential}>
        <label>Analyzer<select name="analyzerId" required defaultValue=""><option value="">Select analyzer…</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Credential name<input name="name" required placeholder="Bridge workstation / service" /></label>
        <label>Expires at<input name="expiresAt" type="datetime-local" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "credential" ? "Issuing…" : "Issue Credential"}</button>
      </form>
      {issuedToken && <div className="detail-section">
        <strong>Copy now — shown once</strong>
        <code style={{overflowWrap:"anywhere"}}>{issuedToken}</code>
      </div>}
    </article>

    <article className="detail-card">
      <h2>Create Test Mapping</h2>
      <form className="catalog-form" onSubmit={createMapping}>
        <label>Analyzer<select name="analyzerId" required defaultValue=""><option value="">Select analyzer…</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Analyzer test code<input name="analyzerTestCode" required maxLength={120} /></label>
        <label>Analyzer unit code<input name="analyzerUnitCode" maxLength={80} /></label>
        <label>LIS test<select name="testId" required value={mappingTestId} onChange={event => setMappingTestId(event.target.value)}><option value="">Select test…</option>{tests.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Component<select name="componentId" defaultValue="" disabled={!mappingTestId || mappingComponents.length === 0}><option value="">{mappingComponents.length ? "Select component…" : "Simple test"}</option>{mappingComponents.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "mapping" ? "Saving…" : "Create Mapping"}</button>
      </form>
    </article>
    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
