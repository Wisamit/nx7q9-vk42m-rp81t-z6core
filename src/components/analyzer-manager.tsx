"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Department = { id: string; code: string; nameEn: string; nameAr?: string | null; branchId: string | null };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null; components: Array<{ id: string; code: string; nameEn: string; nameAr?: string | null }> };
type AnalyzerOption = { id: string; code: string; name: string; branchId: string };

export function AnalyzerManager({
  branches,
  departments,
  tests,
  analyzers,
  locale,
}: {
  branches: Branch[];
  departments: Department[];
  tests: TestOption[];
  analyzers: AnalyzerOption[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [mappingTestId, setMappingTestId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [open, setOpen] = useState<"analyzer" | "credential" | "mapping" | "">("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

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
      setMessage(tr("Analyzer configuration could not be saved.", "تعذر حفظ إعداد جهاز التحليل."));
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
      setMessage(tr("Analyzer created.", "تم إنشاء جهاز التحليل."));
      setOpen("");
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
      setMessage(tr("Bridge credential created. Copy the token now; it will not be shown again.", "تم إنشاء بيانات اعتماد الجسر. انسخ الرمز الآن لأنه لن يظهر مرة أخرى."));
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
      setMessage(tr("Analyzer mapping draft created. It cannot receive clinical results until approved.", "تم إنشاء مسودة ربط الجهاز. لا يمكنها استقبال نتائج سريرية قبل الاعتماد."));
      setOpen("");
    }
  }

  return <>
    <div className="crud-action-bar detail-section">
      <div>{message && <span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" onClick={() => { setMessage(""); setOpen("analyzer"); }}><SystemIcon name="plus" size={16}/>{tr("Register Analyzer","تسجيل جهاز تحليل")}</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setIssuedToken(""); setOpen("credential"); }}><SystemIcon name="plus" size={16}/>{tr("Issue Credential","إصدار بيانات اعتماد")}</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("mapping"); }}><SystemIcon name="plus" size={16}/>{tr("Create Mapping","إنشاء ربط")}</button>
      </div>
    </div>

    <CrudModal open={open === "analyzer"} onClose={() => setOpen("")} title={tr("Register Analyzer","تسجيل جهاز تحليل")} description={tr("Store analyzer identity, branch, protocol and routing metadata. Device connectivity remains in Analyzer Bridge.","احفظ هوية الجهاز والفرع والبروتوكول وبيانات التوجيه. يبقى اتصال الجهاز الفعلي ضمن Analyzer Bridge.")} size="lg">
      <form className="catalog-form" onSubmit={createAnalyzer}>
        <label>{tr("Branch","الفرع")}<select name="branchId" required value={branchId} onChange={event => setBranchId(event.target.value)}>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Department","القسم")}<select name="departmentId" defaultValue=""><option value="">{tr("Unassigned","غير معين")}</option>{branchDepartments.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Code","الرمز")}<input name="code" required maxLength={80} /></label>
        <label>{tr("Name","الاسم")}<input name="name" required maxLength={200} /></label>
        <label>{tr("Manufacturer","الشركة المصنعة")}<input name="manufacturer" maxLength={150} /></label>
        <label>{tr("Model","الطراز")}<input name="model" maxLength={150} /></label>
        <label>{tr("Serial number","الرقم التسلسلي")}<input name="serialNumber" maxLength={150} /></label>
        <label>{tr("Protocol","البروتوكول")}<select name="protocol" defaultValue="ASTM"><option>ASTM</option><option value="HL7_V2">HL7 v2</option><option>FILE</option><option>CSV</option><option>HTTP</option></select></label>
        <label>{tr("Transport","وسيلة الاتصال")}<select name="transport" defaultValue="SERIAL"><option>SERIAL</option><option>TCP_CLIENT</option><option>TCP_SERVER</option><option>WATCH_FOLDER</option><option>HTTP</option></select></label>
        <label>{tr("Bridge device key","مفتاح الجهاز في الجسر")}<input name="bridgeDeviceKey" maxLength={150} placeholder={tr("Local bridge identifier","معرّف محلي في الجسر")} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "analyzer" ? tr("Saving…","جارٍ الحفظ…") : tr("Register Analyzer","تسجيل جهاز التحليل")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "credential"} onClose={() => setOpen("")} title={tr("Issue Bridge Credential","إصدار بيانات اعتماد الجسر")} description={tr("The raw token is shown once. Copy it before closing this window.","يظهر الرمز الخام مرة واحدة فقط. انسخه قبل إغلاق هذه النافذة.")} size="md">
      <form className="catalog-form" onSubmit={createCredential}>
        <label className="form-span">{tr("Analyzer","الجهاز")}<select name="analyzerId" required defaultValue=""><option value="">{tr("Select analyzer…","اختر الجهاز…")}</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>{tr("Credential name","اسم بيانات الاعتماد")}<input name="name" required placeholder={tr("Bridge workstation / service","محطة عمل / خدمة الجسر")} /></label>
        <label>{tr("Expires at","تنتهي في")}<input name="expiresAt" type="datetime-local" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "credential" ? tr("Issuing…","جارٍ الإصدار…") : tr("Issue Credential","إصدار بيانات الاعتماد")}</button>
      </form>
      {issuedToken && <div className="credential-token-box"><strong>{tr("Copy now — shown once","انسخ الآن — يظهر مرة واحدة")}</strong><code>{issuedToken}</code></div>}
      {message && <div className="form-success">{message}</div>}
    </CrudModal>

    <CrudModal open={open === "mapping"} onClose={() => setOpen("")} title={tr("Create Test Mapping Draft","إنشاء مسودة ربط فحص")} description={tr("Create a governed analyzer-to-LIS mapping draft. Unit-bearing targets require the exact analyzer unit code; approval is required before clinical use and no unit conversion is performed.","أنشئ مسودة ربط محكومة بين الجهاز وLIS. الأهداف ذات الوحدة تتطلب رمز وحدة الجهاز بدقة، ويلزم الاعتماد قبل الاستخدام السريري ولا يتم إجراء تحويل للوحدات.")} size="lg">
      <form className="catalog-form" onSubmit={createMapping}>
        <label>{tr("Analyzer","الجهاز")}<select name="analyzerId" required defaultValue=""><option value="">{tr("Select analyzer…","اختر الجهاز…")}</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>{tr("Analyzer test code","رمز الفحص في الجهاز")}<input name="analyzerTestCode" required maxLength={120} /></label>
        <label>{tr("Analyzer unit code","رمز الوحدة في الجهاز")}<input name="analyzerUnitCode" maxLength={80} /></label>
        <label>{tr("LIS test","فحص LIS")}<select name="testId" required value={mappingTestId} onChange={event => setMappingTestId(event.target.value)}><option value="">{tr("Select test…","اختر الفحص…")}</option>{tests.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Component","المكوّن")}<select name="componentId" defaultValue="" disabled={!mappingTestId || mappingComponents.length === 0}><option value="">{mappingComponents.length ? tr("Select component…","اختر المكوّن…") : tr("Simple test","فحص بسيط")}</option>{mappingComponents.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Effective from","ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to","ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "mapping" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Draft","إنشاء المسودة")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>
  </>;
}
