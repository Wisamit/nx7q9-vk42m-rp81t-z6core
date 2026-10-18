"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { summarizeWebhookDispatch } from "@/lib/webhook-dispatch-outcome";

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
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [uiDialog, setUiDialog] = useState("");
  const [secret, setSecret] = useState("");
  const [testId, setTestId] = useState("");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchUncertain, setDispatchUncertain] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  async function post(url: string, payload: unknown, key: string, successEn: string, successAr: string) {
    if (submitting.current) return { ok: false, body: {} };
    submitting.current = true;
    setBusy(key);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      setIsError(!response.ok);
      setMessage(response.ok ? tr(successEn, successAr) : tr("Action failed.", "فشلت العملية."));
      if (response.ok) router.refresh();
      return { ok: response.ok, body };
    } catch {
      setIsError(true);
      setMessage(key === "key"
        ? tr("Connection interrupted. Check issued keys before requesting another secret.", "انقطع الاتصال. تحقق من المفاتيح الصادرة قبل طلب سر جديد.")
        : tr("Connection interrupted. Check the existing configuration before retrying.", "انقطع الاتصال. تحقق من الإعدادات الموجودة قبل إعادة المحاولة."));
      return { ok: false, body: {} };
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function createEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await post("/api/integrations/endpoints", {
      code: form.get("code"), name: form.get("name"), branchId: form.get("branchId"),
      endpointType: form.get("endpointType"), direction: form.get("direction"),
      baseUrl: form.get("baseUrl"), authType: form.get("authType"),
      secretReference: form.get("secretReference"),
      timeoutSeconds: form.get("timeoutSeconds"), maxAttempts: form.get("maxAttempts"),
    }, "endpoint", "Integration endpoint created.", "تم إنشاء نقطة التكامل.");
    if (result.ok) formElement.reset();
  }

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await post("/api/integrations/terminology", {
      testId: form.get("testId"), componentId: form.get("componentId"),
      system: form.get("system"), code: form.get("code"), display: form.get("display"),
      systemVersion: form.get("systemVersion"), isPrimary: true,
      effectiveFrom: form.get("effectiveFrom"), effectiveTo: form.get("effectiveTo"),
    }, "mapping", "Terminology mapping created.", "تم إنشاء ربط المصطلحات.");
    if (result.ok) { formElement.reset(); setTestId(""); }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || secret) return;
    const form = new FormData(event.currentTarget);
    const scopes = ["fhir.read","hl7.write","messages.read","messages.ack"].filter(scope => form.get("scope-" + scope) === "on");
    const result = await post("/api/integrations/api-keys", {
      endpointId: form.get("endpointId"), name: form.get("name"), scopes, expiresAt: form.get("expiresAt"),
    }, "key", "API key created. Copy the secret now.", "تم إنشاء مفتاح API. انسخ السر الآن.");
    if (result.ok) {
      const generated = result.body.apiKey?.secret;
      if (typeof generated === "string" && generated) setSecret(generated);
      else {
        setIsError(true);
        setMessage(tr(
          "No one-time secret was returned. Review issued API keys before another request.",
          "لم يُرجع سر المفتاح لمرة واحدة. راجع مفاتيح API الصادرة قبل أي طلب جديد.",
        ));
      }
    }
  }

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await post("/api/integrations/webhooks", {
      endpointId: form.get("endpointId"), eventType: form.get("eventType"),
    }, "subscription", "Webhook subscription enabled.", "تم تفعيل اشتراك Webhook.");
  }

  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReplay || !dispatchOpen || dispatchUncertain || submitting.current || busy) return;
    // A lost reply can follow successful external transmission. Prevent
    // blind replay of this batch until a full reload of current queue state.
    submitting.current = true;
    setDispatchUncertain(true);
    setBusy("dispatch");
    setIsError(false);
    setMessage("");
    setDispatchError("");
    try {
      const response = await fetch("/api/integrations/webhooks/dispatch", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = response.ok ? summarizeWebhookDispatch(body) : { kind: "invalid" as const };
      if (outcome.kind === "invalid") {
        throw new Error(tr(
          "The dispatch outcome is unconfirmed. Some external deliveries may already have occurred. Inspect the queue and audit log, then reload before another dispatch.",
          "نتيجة الإرسال غير مؤكدة. قد تكون بعض الرسائل وصلت خارجياً. افحص قائمة الإرسال وسجل التدقيق ثم أعد تحميل الصفحة قبل محاولة جديدة.",
        ));
      }
      setDispatchOpen(false);
      router.refresh();
      if (outcome.kind === "empty") {
        setMessage(tr(
          "No due webhook deliveries were attempted. Inspect the refreshed queue before starting another run.",
          "لم تُنفذ أي محاولة إرسال مستحقة. افحص القائمة المحدّثة قبل تشغيل دفعة أخرى.",
        ));
      } else {
        const summary = tr(
          `Run finished: ${outcome.attempted} attempted; ${outcome.httpAccepted} HTTP-accepted; ${outcome.failed} failed, ${outcome.deadLetter} dead-letter, ${outcome.errors} dispatch errors, ${outcome.skipped} skipped. Provider processing/clinical receipt is NOT verified by an HTTP response.`,
          `اكتمل تشغيل الدفعة: ${outcome.attempted} محاولة؛ ${outcome.httpAccepted} قبول HTTP؛ ${outcome.failed} فاشلة، ${outcome.deadLetter} نهائية غير قابلة للإرسال، ${outcome.errors} أخطاء تشغيل، ${outcome.skipped} متجاوزة. استجابة HTTP لا تثبت معالجة المستلم أو استلامه السريري.`,
        );
        setMessage(summary);
      }
      setIsError(outcome.kind === "partial");
    } catch (error) {
      const message = error instanceof Error ? error.message : tr(
        "Dispatch may have sent external messages. Inspect the queue and audit history; reload before retrying.",
        "ربما أرسل التشغيل رسائل خارجية. افحص القائمة وسجل التدقيق وأعد التحميل قبل تكرار المحاولة.",
      );
      setDispatchError(message);
      setIsError(true);
      setMessage(message);
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  const selectedTest = tests.find(test => test.id === testId);

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>{tr("Integration Endpoint", "نقطة التكامل")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("endpoint"); }}>
      {tr("Configure Integration Endpoint", "إعداد نقطة تكامل")}
    </button>
    <CrudModal open={uiDialog === "endpoint"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Configure Integration Endpoint", "إعداد نقطة تكامل")}
      description={tr("Endpoints preserve branch scope and audited credentials; review direction and protocol.", "تحتفظ نقاط التكامل بنطاق الفروع والتدقيق؛ راجع الاتجاه والبروتوكول.")}>
      {uiDialog === "endpoint" && <form className="catalog-form" onSubmit={createEndpoint}>
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
      </form>}
      {uiDialog === "endpoint" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("LOINC / Terminology Mapping", "ربط LOINC / المصطلحات")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("mapping"); }}>
      {tr("Configure Terminology Mapping", "إعداد ربط المصطلحات")}
    </button>
    <CrudModal open={uiDialog === "mapping"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Configure Terminology Mapping", "إعداد ربط المصطلحات")}
      description={tr("Choose the exact test/component and standard code; mappings are versioned.", "اختر الفحص والمكوّن والرمز المعياري بدقة؛ الربط قابل للإصدار.")}>
      {uiDialog === "mapping" && <form className="catalog-form" onSubmit={createMapping}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={testId} onChange={event => setTestId(event.target.value)}><option value="">{tr("Select test…", "اختر الفحص…")}</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}</select></label>
        <label>{tr("Component", "المكوّن")}<select name="componentId" defaultValue=""><option value="">{tr("Whole test", "الفحص الكامل")}</option>{(selectedTest?.components || []).map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}</select></label>
        <label>{tr("System", "النظام")}<select name="system" defaultValue="LOINC"><option>LOINC</option><option>SNOMED_CT</option><option>ICD10</option><option>LOCAL</option></select></label>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Display", "اسم العرض")}<input name="display" /></label>
        <label>{tr("System version", "إصدار النظام")}<input name="systemVersion" /></label>
        <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<input name="effectiveFrom" type="date" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "mapping" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Mapping", "إنشاء الربط")}</button>
      </form>}
      {uiDialog === "mapping" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {canManageKeys && <article className="detail-card">
      <h2>{tr("External API Key", "مفتاح API خارجي")}</h2>
      <p className="muted">{tr("The secret is displayed once. Only its SHA-256 hash is stored.", "يُعرض السر مرة واحدة فقط، ويُخزن فقط تجزئته SHA-256.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setSecret(""); setUiDialog("key"); }}>
      {tr("Issue External API Key", "إصدار مفتاح API خارجي")}
    </button>
    <CrudModal open={uiDialog === "key"} onClose={() => { if (!submitting.current) { setSecret(""); setUiDialog(""); } }}
      size="compact"
      title={tr("Issue External API Key", "إصدار مفتاح API خارجي")}
      description={tr("The new secret is displayed once; copy it before dismissing the dialog.", "يظهر السر الجديد مرة واحدة فقط؛ انسخه قبل إغلاق النافذة.")}>
      {uiDialog === "key" && <form className="catalog-form" onSubmit={createKey}>
        <label>{tr("Endpoint", "نقطة التكامل")}<select name="endpointId" required defaultValue=""><option value="">{tr("Select endpoint…", "اختر نقطة التكامل…")}</option>{endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>{tr("Name", "الاسم")}<input name="name" required placeholder={tr("Hospital integration key", "مفتاح تكامل المستشفى")} /></label>
        <label>{tr("Expires", "تاريخ الانتهاء")}<input name="expiresAt" type="date" /></label>
        <div className="form-span result-actions">
          {["fhir.read","hl7.write","messages.read","messages.ack"].map(scope => <label key={scope}><input type="checkbox" name={"scope-" + scope} /> {scope}</label>)}
        </div>
        <button className="primary-button form-span" disabled={busy !== "" || Boolean(secret)}>{busy === "key" ? tr("Creating…", "جارٍ الإنشاء…") : tr("Create API Key", "إنشاء مفتاح API")}</button>
      </form>}
      {uiDialog === "key" && message && <p className="form-warning" role="status">{message}</p>}
    {uiDialog === "key" && secret && <div className="credential-token-box" role="status">
      <strong>{tr("Copy this key now — the secret will not be displayed by the server again.",
        "انسخ هذا المفتاح الآن — لن يعرض السيرفر السر مرة أخرى.")}</strong>
      <code dir="ltr">{secret}</code>
    </div>}
    </CrudModal>
      
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("Webhook Subscription", "اشتراك Webhook")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("subscription"); }}>
      {tr("Configure Webhook Subscription", "إعداد اشتراك Webhook")}
    </button>
    <CrudModal open={uiDialog === "subscription"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Configure Webhook Subscription", "إعداد اشتراك Webhook")}
      description={tr("Webhook subscriptions are scoped to the selected authorized integration endpoint.", "الاشتراكات محصورة في نقطة التكامل المخوّلة المحددة.")}>
      {uiDialog === "subscription" && <form className="catalog-form" onSubmit={subscribe}>
        <label>{tr("Endpoint", "نقطة التكامل")}<select name="endpointId" required defaultValue=""><option value="">{tr("Select outbound endpoint…", "اختر نقطة تكامل صادرة…")}</option>{endpoints.filter(endpoint => ["WEBHOOK","REST"].includes(endpoint.endpointType) && ["OUTBOUND","BIDIRECTIONAL"].includes(endpoint.direction)).map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.code} — {endpoint.name}</option>)}</select></label>
        <label>{tr("Event", "الحدث")}<select name="eventType" defaultValue="diagnostic_report.released"><option value="diagnostic_report.released">{tr("Diagnostic report released", "إصدار تقرير تشخيصي")}</option><option value="diagnostic_report.amended">{tr("Diagnostic report amended", "تعديل تقرير تشخيصي")}</option></select></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "subscription" ? tr("Saving…", "جارٍ الحفظ…") : tr("Enable Subscription", "تفعيل الاشتراك")}</button>
      </form>}
      {uiDialog === "subscription" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {canReplay && <article className="detail-card">
      <h2>{tr("Outbound Retry Queue", "قائمة إعادة محاولة الإرسال")}</h2>
      <p className="muted">{tr("Dispatches due queued/failed webhook deliveries. Result release is never repeated.", "تعيد إرسال عمليات Webhook المستحقة أو الفاشلة. إصدار النتيجة نفسه لا يُكرر أبدًا.")}</p>
      <button className="secondary-button" type="button" disabled={busy !== "" || dispatchUncertain}
        onClick={() => { if (!submitting.current && !dispatchUncertain) { setDispatchError(""); setDispatchOpen(true); } }}>
        {busy === "dispatch" ? tr("Dispatching…", "جارٍ الإرسال…") : tr("Review Due Webhook Dispatch", "مراجعة إرسال Webhooks المستحقة")}
      </button>
      {dispatchUncertain && !dispatchOpen && <p role="status" className="muted">{tr(
        "Review the updated queue and reload this page before another manual dispatch. A second run is not automatic.",
        "افحص قائمة الإرسال المحدّثة وأعد تحميل الصفحة قبل تشغيل دفعة يدوية أخرى. لن يُعاد الإرسال تلقائياً.",
      )}</p>}
      <CrudModal open={dispatchOpen} onClose={() => { if (!submitting.current && !busy) setDispatchOpen(false); }}
        size="compact"
        title={tr("Review external webhook dispatch", "مراجعة إرسال إشعارات Webhook الخارجية")}
        description={tr(
          "This sends due queued/failed events to external configured endpoints. It does not re-release or amend a laboratory result. HTTP acceptance is not proof of clinical receipt.",
          "يرسل هذا الإجراء الأحداث المستحقة أو الفاشلة إلى نقاط التكامل الخارجية المهيأة. لا يعيد إصدار النتائج أو تعديلها، وقبول HTTP لا يثبت الاستلام السريري.",
        )}>
        {dispatchOpen && <form className="catalog-form" onSubmit={dispatch}>
          <p className="form-span">{tr(
            "Up to 20 due deliveries may be claimed in one run across authorized branches; results depend on live queue state. An external receiver may see an at-least-once retry. The receiver must deduplicate by x-family-lab-delivery-id.",
            "قد تُطلب معالجة حتى 20 رسالة مستحقة في الدفعة ضمن الفروع المصرّح بها حسب حالة القائمة الحالية. قد يتلقى المستلم محاولة مكررة وفق سياسة التسليم مرة واحدة على الأقل، وعليه إزالة التكرار باستخدام x-family-lab-delivery-id.",
          )}</p>
          <p className="form-span muted">{tr(
            "Recheck the outgoing endpoints, recipients and payload governance before confirming. A lost network response may follow successful transmission; never blindly run the same action again.",
            "تحقق من نقاط التكامل والمستلمين وحوكمة محتوى الإرسال قبل التأكيد. قد تضيع استجابة الشبكة بعد وصول الرسالة؛ لا تكرر التشغيل دون فحص.",
          )}</p>
          {dispatchError && <p role="alert" className="form-error form-span">{dispatchError}</p>}
          <div className="crud-modal-actions form-span">
            <button type="button" className="secondary-button" disabled={Boolean(busy)}
              onClick={() => setDispatchOpen(false)}>{tr("Cancel", "إلغاء")}</button>
            <button type="submit" className="primary-button" disabled={Boolean(busy) || dispatchUncertain}>
              {busy === "dispatch" ? tr("Dispatching…", "جارٍ الإرسال…") : tr("Confirm external dispatch", "تأكيد الإرسال الخارجي")}
            </button>
          </div>
        </form>}
      </CrudModal>
    </article>}

    {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
  </section>;
}
