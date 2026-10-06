"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Test = { id: string; code: string; nameEn: string; nameAr?: string | null; components: Array<{ id: string; code: string; nameEn: string; nameAr?: string | null }> };
type Endpoint = { id: string; code: string; name: string; endpointType: string; direction: string };

export function IntegrationManager({
  branches,
  tests,
  endpoints,
  canManage,
  canManageKeys,
  canReplay,
  locale,
}: {
  branches: Branch[];
  tests: Test[];
  endpoints: Endpoint[];
  canManage: boolean;
  canManageKeys: boolean;
  canReplay: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [testId, setTestId] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  async function post(url: string, payload: unknown, key: string, successEn: string, successAr: string) {
    setBusy(key); setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? tr(successEn, successAr) : tr("Action failed.", "فشلت العملية."));
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
    }, "endpoint", "Integration endpoint created.", "تم إنشاء نقطة التكامل.");
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
    }, "mapping", "Terminology mapping created.", "تم إنشاء ربط المصطلحات.");
    if (result.ok) { event.currentTarget.reset(); setTestId(""); }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSecret("");
    const form = new FormData(event.currentTarget);
    const scopes = ["fhir.read","hl7.write","messages.read","messages.ack"].filter(scope => form.get("scope-" + scope) === "on");
    const result = await post("/api/integrations/api-keys", {
      endpointId: form.get("endpointId"), name: form.get("name"), scopes, expiresAt: form.get("expiresAt"),
    }, "key", "API key created. Copy the secret now.", "تم إنشاء مفتاح API. انسخ السر الآن.");
    if (result.ok && result.body.apiKey?.secret) setSecret(result.body.apiKey.secret);
  }

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post("/api/integrations/webhooks", {
      endpointId: form.get("endpointId"), eventType: form.get("eventType"),
    }, "subscription", "Webhook subscription enabled.", "تم تفعيل اشتراك Webhook.");
  }

  async function dispatch() {
    await post("/api/integrations/webhooks/dispatch", {}, "dispatch", "Webhook dispatch run completed.", "اكتملت عملية إرسال Webhook.");
  }

  const selectedTest = tests.find(test => test.id === testId);

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>{tr("Integration Endpoint", "نقطة التكامل")}</h2>
      <form className="catalog-form" onSubmit={createEndpoint}>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name", "الاسم")}<input name="name" required /></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide", "على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Type", "النوع")}<select name="endpointType" defaultValue="FHIR_R4"><option>FHIR_R4</option><option>HL7_V2</option><option>REST</option><option>WEBHOOK</option></select></label>
        <label>{tr("Direction", "الاتجاه")}<select name="direction" defaultValue="BIDIRECTIONAL"><option value="INBOUND">{tr("Inbound", "وارد")}</option><option value="OUTBOUND">{tr("Outbound", "صادر")}</option><option value="BIDIRECTIONAL">{tr("Bidirectional", "ثنائي الاتجاه")}</option></select></label>
        <label>{tr("HTTPS base URL", "رابط HTTPS الأساسي")}<input name="baseUrl" type="url" placeholder="https://partner.example/api" /></label>
        <label>{tr("Authentication", "المصادقة")}<select name="authType" defaultValue="NONE"><option value="NONE">{tr("None", "بدون")}</option><option>API_KEY</option><option>BEARER</option><option>BASIC</option><option>HMAC</option></select></label>
        <label>{tr("Secret reference", "مرجع السر")}<input name="secretReference" placeholder="env:PARTNER_WEBHOOK_SECRET" /></label>
        <label>{tr("Timeout seconds", "مهلة الانتظار بالثواني")}<input name="timeoutSeconds" type="number" min="1" max="60" defaultValue="15" /></label>
        <label>{tr("Max attempts", "أقصى عدد محاولات")}<input name="maxAttempts" type="number" min="1" max="20" defaultValue="5" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "endpoint" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Endpoint", "إنشاء نقطة التكامل")}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("LOINC / Terminology Mapping", "ربط LOINC / المصطلحات")}</h2>
      <form className="catalog-form" onSubmit={createMapping}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={testId} onChange={event => setTestId(event.target.value)}><option value="">{tr("Select test…", "اختر الفحص…")}</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}</select></label>
        <label>{tr("Component", "المكوّن")}<select name="componentId" defaultValue=""><option value="">{tr("Whole test", "الفحص الكامل")}</option>{(selectedTest?.components || []).map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}</select></label>
        <label>{tr("System", "النظام")}<select name="system" defaultValue="LOINC"><option>LOINC</option><option>SNOMED_CT</option><option>ICD10</option><option>LOCAL</option></select></label>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Display", "اسم العرض")}<input name="display" /></label>
        <label>{tr("System version", "إصدار النظام")}<input name="systemVersion" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "mapping" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Mapping", "إنشاء الربط")}</button>
      </form>
    </article>}

    {canManageKeys && <article className="detail-card">
      <h2>{tr("External API Key", "مفتاح API خارجي")}</h2>
      <p className="muted">{tr("The secret is displayed once. Only its SHA-256 hash is stored.", "يُعرض السر مرة واحدة فقط، ويُخزن فقط تجزئته SHA-256.")}</p>
      <form className="catalog-form" onSubmit={createKey}>
        <label>{tr("Endpoint", "نقطة التكامل")}<select name="endpointId" required defaultValue=""><option value="">{tr("Select endpoint…", "اختر نقطة التكامل…")}</option>{endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>{tr("Name", "الاسم")}<input name="name" required placeholder={tr("Hospital integration key", "مفتاح تكامل المستشفى")} /></label>
        <label>{tr("Expires", "تاريخ الانتهاء")}<input name="expiresAt" type="date" /></label>
        <div className="form-span result-actions">
          {["fhir.read","hl7.write","messages.read","messages.ack"].map(scope => <label key={scope}><input type="checkbox" name={"scope-" + scope} /> {scope}</label>)}
        </div>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "key" ? tr("Creating…", "جارٍ الإنشاء…") : tr("Create API Key", "إنشاء مفتاح API")}</button>
      </form>
      {secret && <div className="integration-secret"><strong>{tr("Copy now — shown once", "انسخه الآن — يظهر مرة واحدة فقط")}</strong><code>{secret}</code></div>}
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("Webhook Subscription", "اشتراك Webhook")}</h2>
      <form className="catalog-form" onSubmit={subscribe}>
        <label>{tr("Endpoint", "نقطة التكامل")}<select name="endpointId" required defaultValue=""><option value="">{tr("Select outbound endpoint…", "اختر نقطة تكامل صادرة…")}</option>{endpoints.filter(endpoint => ["WEBHOOK","REST"].includes(endpoint.endpointType) && ["OUTBOUND","BIDIRECTIONAL"].includes(endpoint.direction)).map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>{tr("Event", "الحدث")}<select name="eventType" defaultValue="diagnostic_report.released"><option value="diagnostic_report.released">{tr("Diagnostic report released", "إصدار تقرير تشخيصي")}</option><option value="diagnostic_report.amended">{tr("Diagnostic report amended", "تعديل تقرير تشخيصي")}</option></select></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "subscription" ? tr("Saving…", "جارٍ الحفظ…") : tr("Enable Subscription", "تفعيل الاشتراك")}</button>
      </form>
    </article>}

    {canReplay && <article className="detail-card">
      <h2>{tr("Outbound Retry Queue", "قائمة إعادة محاولة الإرسال")}</h2>
      <p className="muted">{tr("Dispatches due queued/failed webhook deliveries. Result release is never repeated.", "تعيد إرسال عمليات Webhook المستحقة أو الفاشلة. إصدار النتيجة نفسه لا يُكرر أبدًا.")}</p>
      <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void dispatch()}>{busy === "dispatch" ? tr("Dispatching…", "جارٍ الإرسال…") : tr("Dispatch Due Webhooks", "إرسال Webhooks المستحقة")}</button>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
