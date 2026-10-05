"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type Test = { id: string; code: string; nameEn: string; components: Array<{ id: string; code: string; nameEn: string }> };
type Endpoint = { id: string; code: string; name: string; endpointType: string; direction: string };

export function IntegrationManager({
  branches,
  tests,
  endpoints,
  canManage,
  canManageKeys,
  canReplay,
}: {
  branches: Branch[];
  tests: Test[];
  endpoints: Endpoint[];
  canManage: boolean;
  canManageKeys: boolean;
  canReplay: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [testId, setTestId] = useState("");

  async function post(url: string, payload: unknown, key: string, success: string) {
    setBusy(key); setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Action failed.");
    if (response.ok) router.refresh();
    return { ok: response.ok, body };
  }

  async function createEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await post("/api/integrations/endpoints", {
      code: form.get("code"), name: form.get("name"), branchId: form.get("branchId"),
      endpointType: form.get("endpointType"), direction: form.get("direction"),
      baseUrl: form.get("baseUrl"), authType: form.get("authType"),
      secretReference: form.get("secretReference"),
      timeoutSeconds: form.get("timeoutSeconds"), maxAttempts: form.get("maxAttempts"),
    }, "endpoint", "Integration endpoint created.");
    if (result.ok) event.currentTarget.reset();
  }

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await post("/api/integrations/terminology", {
      testId: form.get("testId"), componentId: form.get("componentId"),
      system: form.get("system"), code: form.get("code"), display: form.get("display"),
      systemVersion: form.get("systemVersion"), isPrimary: true,
      effectiveFrom: form.get("effectiveFrom"), effectiveTo: form.get("effectiveTo"),
    }, "mapping", "Terminology mapping created.");
    if (result.ok) { event.currentTarget.reset(); setTestId(""); }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSecret("");
    const form = new FormData(event.currentTarget);
    const scopes = ["fhir.read","hl7.write","messages.read"].filter(scope => form.get("scope-" + scope) === "on");
    const result = await post("/api/integrations/api-keys", {
      endpointId: form.get("endpointId"), name: form.get("name"), scopes, expiresAt: form.get("expiresAt"),
    }, "key", "API key created. Copy the secret now.");
    if (result.ok && result.body.apiKey?.secret) setSecret(result.body.apiKey.secret);
  }

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post("/api/integrations/webhooks", {
      endpointId: form.get("endpointId"), eventType: form.get("eventType"),
    }, "subscription", "Webhook subscription enabled.");
  }

  async function dispatch() {
    await post("/api/integrations/webhooks/dispatch", {}, "dispatch", "Webhook dispatch run completed.");
  }

  const selectedTest = tests.find(test => test.id === testId);

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>Integration Endpoint</h2>
      <form className="catalog-form" onSubmit={createEndpoint}>
        <label>Code<input name="code" required /></label>
        <label>Name<input name="name" required /></label>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Type<select name="endpointType" defaultValue="FHIR_R4"><option>FHIR_R4</option><option>HL7_V2</option><option>REST</option><option>WEBHOOK</option></select></label>
        <label>Direction<select name="direction" defaultValue="BIDIRECTIONAL"><option>INBOUND</option><option>OUTBOUND</option><option>BIDIRECTIONAL</option></select></label>
        <label>HTTPS base URL<input name="baseUrl" type="url" placeholder="https://partner.example/api" /></label>
        <label>Auth<select name="authType" defaultValue="NONE"><option>NONE</option><option>API_KEY</option><option>BEARER</option><option>BASIC</option><option>HMAC</option></select></label>
        <label>Secret reference<input name="secretReference" placeholder="env:PARTNER_WEBHOOK_SECRET" /></label>
        <label>Timeout seconds<input name="timeoutSeconds" type="number" min="1" max="60" defaultValue="15" /></label>
        <label>Max attempts<input name="maxAttempts" type="number" min="1" max="20" defaultValue="5" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "endpoint" ? "Saving…" : "Create Endpoint"}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>LOINC / Terminology Mapping</h2>
      <form className="catalog-form" onSubmit={createMapping}>
        <label>Test<select name="testId" required value={testId} onChange={event => setTestId(event.target.value)}><option value="">Select test…</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}</select></label>
        <label>Component<select name="componentId" defaultValue=""><option value="">Whole test</option>{(selectedTest?.components || []).map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}</select></label>
        <label>System<select name="system" defaultValue="LOINC"><option>LOINC</option><option>SNOMED_CT</option><option>ICD10</option><option>LOCAL</option></select></label>
        <label>Code<input name="code" required /></label>
        <label>Display<input name="display" /></label>
        <label>System version<input name="systemVersion" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "mapping" ? "Saving…" : "Create Mapping"}</button>
      </form>
    </article>}

    {canManageKeys && <article className="detail-card">
      <h2>External API Key</h2>
      <p className="muted">The secret is displayed once. Only its SHA-256 hash is stored.</p>
      <form className="catalog-form" onSubmit={createKey}>
        <label>Endpoint<select name="endpointId" required defaultValue=""><option value="">Select endpoint…</option>{endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>Name<input name="name" required placeholder="Hospital integration key" /></label>
        <label>Expires<input name="expiresAt" type="date" /></label>
        <div className="form-span result-actions">
          {["fhir.read","hl7.write","messages.read"].map(scope => <label key={scope}><input type="checkbox" name={"scope-" + scope} /> {scope}</label>)}
        </div>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "key" ? "Creating…" : "Create API Key"}</button>
      </form>
      {secret && <div className="integration-secret"><strong>Copy now — shown once</strong><code>{secret}</code></div>}
    </article>}

    {canManage && <article className="detail-card">
      <h2>Webhook Subscription</h2>
      <form className="catalog-form" onSubmit={subscribe}>
        <label>Endpoint<select name="endpointId" required defaultValue=""><option value="">Select outbound endpoint…</option>{endpoints.filter(endpoint => ["WEBHOOK","REST"].includes(endpoint.endpointType) && ["OUTBOUND","BIDIRECTIONAL"].includes(endpoint.direction)).map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>Event<select name="eventType" defaultValue="diagnostic_report.released"><option value="diagnostic_report.released">Diagnostic report released</option><option value="diagnostic_report.amended">Diagnostic report amended</option></select></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "subscription" ? "Saving…" : "Enable Subscription"}</button>
      </form>
    </article>}

    {canReplay && <article className="detail-card">
      <h2>Outbound Retry Queue</h2>
      <p className="muted">Dispatches due queued/failed webhook deliveries. Result release is never repeated.</p>
      <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void dispatch()}>{busy === "dispatch" ? "Dispatching…" : "Dispatch Due Webhooks"}</button>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
