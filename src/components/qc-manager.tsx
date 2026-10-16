"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Analyzer = { id: string; code: string; name: string; branchId: string };
type Material = { id: string; code: string; nameEn: string; nameAr?: string | null; levelName: string };
type Lot = { id: string; materialId: string; lotNumber: string; label: string };
type Component = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Test = { id: string; code: string; nameEn: string; nameAr?: string | null; components: Component[] };
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
  locale,
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
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const [resolutionId, setResolutionId] = useState<string|null>(null);
  const [targetTestId, setTargetTestId] = useState("");
  const [runAnalyzerId, setRunAnalyzerId] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const severityLabel = (value: string) =>
    value === "WARNING" || value === "WARN" ? tr("Warning", "تحذير") :
    value === "BLOCK" ? tr("Block", "حظر") :
    value === "CRITICAL" ? tr("Critical", "حرج") :
    value;

  const selectedTest = useMemo(
    () => tests.find(test => test.id === targetTestId) || null,
    [tests, targetTestId],
  );

  async function submit(url: string, payload: unknown, key: string, success: string, form?: HTMLFormElement) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(key);
    setIsError(false);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as {error?: string};
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error || tr("Action failed; review QC state before retrying.",
          "فشلت العملية؛ راجع حالة ضبط الجودة قبل إعادة المحاولة."));
        return false;
      }
      setMessage(success);
      form?.reset();
      router.refresh();
      return true;
    } catch {
      setIsError(true);
      setMessage(tr("Network error; check the latest QC state before retrying.",
        "خطأ اتصال؛ تحقق من أحدث حالة ضبط الجودة قبل إعادة المحاولة."));
      return false;
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function createMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await submit("/api/qc/materials", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      manufacturer: form.get("manufacturer"),
      levelName: form.get("levelName"),
    }, "material", tr("QC material created.", "تم إنشاء مادة QC."), formElement);
  }

  async function createLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await submit("/api/qc/lots", {
      materialId: form.get("materialId"),
      lotNumber: form.get("lotNumber"),
      receivedAt: form.get("receivedAt"),
      openedAt: form.get("openedAt"),
      expiryDate: form.get("expiryDate"),
    }, "lot", tr("QC lot created.", "تم إنشاء تشغيلة QC."), formElement);
  }

  async function createTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const enabledRules = ["1:2s","1:3s","2:2s","R:4s","4:1s","10x"]
      .filter(rule => form.get("rule-" + rule) === "on");

    const ok = await submit("/api/qc/targets", {
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
    }, "target", tr("QC target created.", "تم إنشاء هدف QC."), formElement);
    if (ok) setTargetTestId("");
  }

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const runTargets = targets.filter(target => target.analyzerId === runAnalyzerId);
    const results = runTargets
      .map(target => ({
        targetId: target.id,
        observedValue: String(form.get("observed-" + target.id) || "").trim(),
      }))
      .filter(item => item.observedValue !== "");

    if (!runAnalyzerId || results.length === 0) {
      setMessage(tr(
        "Select an analyzer, then enter at least one observed QC value.",
        "اختر جهازاً ثم أدخل قيمة QC واحدة ملاحظة على الأقل.",
      ));
      return;
    }

    const ok = await submit("/api/qc/runs", {
      analyzerId: runAnalyzerId,
      runAt: form.get("runAt"),
      notes: form.get("notes"),
      results,
    }, "run", tr("QC run evaluated.", "تم تقييم تشغيل QC."), formElement);
    if (ok) setRunAnalyzerId("");
  }

  function resolveViolation(violationId: string) {
    if (submitting.current || !canResolve) return;
    setMessage("");
    setResolutionId(violationId);
  }

  async function saveResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolutionId || !canResolve || submitting.current) return;
    const form = new FormData(event.currentTarget);
    const actionType = String(form.get("actionType") || "");
    const description = String(form.get("description") || "").trim();
    const resolutionNote = String(form.get("resolutionNote") || "").trim();
    if (!description || !resolutionNote) {
      setMessage(tr("Corrective action and resolution note are required.",
        "وصف الإجراء التصحيحي وملاحظة الحل إلزاميان."));
      return;
    }
    const ok = await submit(`/api/qc/violations/${resolutionId}/resolve`, {
      actionType, description, resolutionNote,
    }, "resolve-" + resolutionId,
      tr("QC violation resolved.", "تمت معالجة مخالفة QC."));
    if (ok) setResolutionId(null);
  }

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>{tr("QC Material", "مادة QC")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("material"); }}>
     {tr("Create QC Material", "إنشاء مادة ضبط جودة")}
   </button>
   <CrudModal open={uiEditor === "material"} onClose={() => {if (!submitting.current && !busy) setUiEditor("");}}
     size="compact" title={tr("Create QC Material", "إنشاء مادة ضبط جودة")}
     description={tr("QC materials require exact identification and branch/device governance.", "تتطلب مواد ضبط الجودة تعريفاً دقيقاً وحوكمة الفرع والجهاز.")}>
     {uiEditor === "material" && <form className="catalog-form" onSubmit={createMaterial}>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Level", "المستوى")}<input name="levelName" placeholder={tr("Level 1 / Normal", "المستوى 1 / طبيعي")} required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Manufacturer", "الشركة المصنعة")}<input name="manufacturer" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "material" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Material", "إنشاء مادة QC")}</button>
      </form>}
     {uiEditor === "material" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("QC Lot", "تشغيلة QC")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("lot"); }}>
     {tr("Create QC Lot", "إنشاء تشغيلة ضبط جودة")}
   </button>
   <CrudModal open={uiEditor === "lot"} onClose={() => {if (!submitting.current && !busy) setUiEditor("");}}
     size="compact" title={tr("Create QC Lot", "إنشاء تشغيلة ضبط جودة")}
     description={tr("Check lot identity and expiry date before adding a QC lot.", "راجع هوية التشغيلة والصلاحية قبل الإنشاء.")}>
     {uiEditor === "lot" && <form className="catalog-form" onSubmit={createLot}>
        <label className="form-span">{tr("Material", "المادة")}<select name="materialId" required defaultValue="">
          <option value="">{tr("Select material…", "اختر المادة…")}</option>
          {materials.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)} · {item.levelName}</option>)}
        </select></label>
        <label>{tr("Lot number", "رقم التشغيلة")}<input name="lotNumber" required /></label>
        <label>{tr("Received", "تاريخ الاستلام")}<SystemDateField name="receivedAt" /></label>
        <label>{tr("Opened", "تاريخ الفتح")}<SystemDateField name="openedAt" /></label>
        <label>{tr("Expiry", "تاريخ الانتهاء")}<SystemDateField name="expiryDate" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "lot" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Lot", "إنشاء تشغيلة QC")}</button>
      </form>}
     {uiEditor === "lot" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("QC Target & Westgard Rules", "هدف QC وقواعد Westgard")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("target"); }}>
     {tr("Configure QC Target", "إعداد هدف ضبط الجودة")}
   </button>
   <CrudModal open={uiEditor === "target"} onClose={() => {if (!submitting.current && !busy) setUiEditor("");}}
     size="compact" title={tr("Configure QC Target", "إعداد هدف ضبط الجودة")}
     description={tr("Targets and Westgard rules require laboratory approval; do not infer limits.", "تتطلب الأهداف وقواعد Westgard اعتماد المختبر؛ لا تخترع حدوداً.")}>
     {uiEditor === "target" && <form className="catalog-form" onSubmit={createTarget}>
        <label>{tr("QC lot", "تشغيلة QC")}<select name="qcLotId" required defaultValue="">
          <option value="">{tr("Select lot…", "اختر التشغيلة…")}</option>
          {lots.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>{tr("Analyzer", "الجهاز")}<select name="analyzerId" required defaultValue="">
          <option value="">{tr("Select analyzer…", "اختر الجهاز…")}</option>
          {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </select></label>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={targetTestId} onChange={event => setTargetTestId(event.target.value)}>
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Component", "المكوّن")}<select name="componentId" defaultValue="" disabled={!selectedTest || selectedTest.components.length === 0}>
          <option value="">{selectedTest?.components.length ? tr("Select component…", "اختر المكوّن…") : tr("Simple test result", "نتيجة فحص بسيط")}</option>
          {(selectedTest?.components || []).map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label>{tr("Target mean", "المتوسط المستهدف")}<input name="targetMean" inputMode="decimal" required /></label>
        <label>{tr("Target SD", "SD المستهدف")}<input name="targetSd" inputMode="decimal" required /></label>
        <label>{tr("Target CV %", "CV المستهدف %")}<input name="targetCv" inputMode="decimal" /></label>
        <label>{tr("Unit", "الوحدة")}<input name="unitSnapshot" /></label>
        <label>{tr("QC valid hours", "صلاحية QC بالساعات")}<input name="qcValidHours" type="number" min="1" max="168" defaultValue="24" required /></label>
        <label>{tr("Effective from (choose intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
        <div className="form-span">
          <strong>{tr("Westgard rules", "قواعد Westgard")}</strong>
          <div className="result-actions">
            {["1:2s","1:3s","2:2s","R:4s","4:1s","10x"].map(rule => <label className="check-line" key={rule}>
              <input type="checkbox" name={"rule-" + rule} defaultChecked={rule !== "10x"} /> {rule}
            </label>)}
          </div>
        </div>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "target" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Target", "إنشاء هدف QC")}</button>
      </form>}
     {uiEditor === "target" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </article>}

    {canEnter && <article className="detail-card">
      <h2>{tr("Enter QC Run", "إدخال تشغيل QC")}</h2>
      <p className="muted">{tr(
        "Enter multiple control levels in the same run when available so multi-level rules such as R:4s are evaluated within the same QC event.",
        "أدخل عدة مستويات ضبط ضمن نفس التشغيل عند توفرها، حتى تُقيّم القواعد متعددة المستويات مثل R:4s ضمن حدث QC نفسه.",
      )}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("run"); }}>
     {tr("Record QC Run", "تسجيل تشغيل ضبط جودة")}
   </button>
   <CrudModal open={uiEditor === "run"} onClose={() => {if (!submitting.current && !busy) setUiEditor("");}}
     size="compact" title={tr("Record QC Run", "تسجيل تشغيل ضبط جودة")}
     description={tr("Recorded QC measurements and release gates must remain traceable.", "تظل قياسات ضبط الجودة وبوابات إصدار النتائج قابلة للتتبع.")}>
     {uiEditor === "run" && <form className="catalog-form" onSubmit={createRun}>
        <label>{tr("Analyzer", "الجهاز")}<select required value={runAnalyzerId} onChange={event => setRunAnalyzerId(event.target.value)}>
          <option value="">{tr("Select analyzer…", "اختر الجهاز…")}</option>
          {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
        </select></label>
        <label>{tr("Run at", "وقت التشغيل")}<input name="runAt" type="datetime-local" /></label>
        <div className="form-span result-field-list">
          {targets.filter(target => target.analyzerId === runAnalyzerId).map(target =>
            <label className="result-field-row" key={target.id}>
              <span>{target.label}</span>
              <input name={"observed-" + target.id} inputMode="decimal" placeholder={tr("Observed value", "القيمة الملاحظة")} />
            </label>
          )}
          {runAnalyzerId && !targets.some(target => target.analyzerId === runAnalyzerId) &&
            <p className="muted">{tr("No active QC targets for this analyzer.", "لا توجد أهداف QC نشطة لهذا الجهاز.")}</p>}
        </div>
        <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "run" ? tr("Evaluating…", "جارٍ التقييم…") : tr("Save & Evaluate QC", "حفظ وتقييم QC")}</button>
      </form>}
     {uiEditor === "run" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </article>}

    {openViolations.length > 0 && <article className="detail-card">
      <h2>{tr("Open QC Violations", "مخالفات QC المفتوحة")}</h2>
      <div className="reflex-list">
        {openViolations.map(item => <div className="reflex-card" key={item.id}>
          <div>
            <span className="eyebrow">{severityLabel(item.severity)}</span>
            <strong>{item.ruleCode} · {item.target}</strong>
            <small>{item.analyzer}</small>
          </div>
          {canResolve && <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void resolveViolation(item.id)}>
            {busy === "resolve-" + item.id ? tr("Resolving…", "جارٍ الحل…") : tr("Resolve", "معالجة")}
          </button>}
        </div>)}
      </div>
    </article>}

    {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
    <CrudModal open={resolutionId!==null}
      onClose={()=>{if(!submitting.current&&!busy)setResolutionId(null);}}
      size="compact"
      title={tr("Resolve QC Violation","معالجة مخالفة ضبط الجودة")}
      description={tr(
        "Document an actual corrective action and the resolution evidence for this specific violation. Server QC release policies remain authoritative.",
        "وثّق الإجراء التصحيحي الفعلي وأدلة الحل لهذه المخالفة تحديداً؛ تظل سياسات ضبط الجودة في السيرفر هي المرجع.",
      )}>
      {resolutionId&&<form className="catalog-form" onSubmit={saveResolution}>
        <label className="form-span">{tr("Corrective action type","نوع الإجراء التصحيحي")}
          <select name="actionType" required defaultValue="INVESTIGATE">
            {["REPEAT_QC","RECALIBRATE","MAINTENANCE","REPLACE_REAGENT","REPLACE_CONTROL","INVESTIGATE","OTHER"].map(code=>
              <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="form-span">{tr("Action performed (required)","الإجراء المنفذ (مطلوب)")}
          <textarea rows={3} maxLength={3000} name="description" required/>
        </label>
        <label className="form-span">{tr("Resolution evidence or note (required)","أدلة الحل أو ملاحظته (مطلوب)")}
          <textarea rows={3} maxLength={3000} name="resolutionNote" required/>
        </label>
        {message&&<p className="form-warning form-span" role="alert">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
          {busy?tr("Saving…","جارٍ الحفظ…"):tr("Confirm QC resolution","تأكيد معالجة المخالفة")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
