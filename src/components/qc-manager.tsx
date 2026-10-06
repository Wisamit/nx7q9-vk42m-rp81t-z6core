"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  const [message, setMessage] = useState("");
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
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : tr("Action failed.", "فشلت العملية."));
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
    }, "material", tr("QC material created.", "تم إنشاء مادة QC."), event.currentTarget);
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
    }, "lot", tr("QC lot created.", "تم إنشاء تشغيلة QC."), event.currentTarget);
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
    }, "target", tr("QC target created.", "تم إنشاء هدف QC."), event.currentTarget);
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
      setMessage(tr(
        "Select an analyzer, then enter at least one observed QC value.",
        "اختر جهازاً ثم أدخل قيمة QC واحدة ملاحظة على الأقل.",
      ));
      return;
    }

    await submit("/api/qc/runs", {
      analyzerId: runAnalyzerId,
      runAt: form.get("runAt"),
      notes: form.get("notes"),
      results,
    }, "run", tr("QC run evaluated.", "تم تقييم تشغيل QC."), event.currentTarget);
    setRunAnalyzerId("");
  }

  async function resolveViolation(violationId: string) {
    const actionType = window.prompt(
      tr(
        "Corrective action type — enter one code: REPEAT_QC, RECALIBRATE, MAINTENANCE, REPLACE_REAGENT, REPLACE_CONTROL, INVESTIGATE, OTHER",
        "نوع الإجراء التصحيحي — أدخل أحد الأكواد: REPEAT_QC, RECALIBRATE, MAINTENANCE, REPLACE_REAGENT, REPLACE_CONTROL, INVESTIGATE, OTHER",
      ),
      "INVESTIGATE",
    );
    if (!actionType) return;
    const description = window.prompt(tr("Describe the corrective action performed:", "صف الإجراء التصحيحي الذي تم تنفيذه:"));
    if (!description?.trim()) return;
    const resolutionNote = window.prompt(tr("Resolution note:", "ملاحظة الحل:"));
    if (!resolutionNote?.trim()) return;

    await submit(`/api/qc/violations/${violationId}/resolve`, {
      actionType,
      description,
      resolutionNote,
    }, "resolve-" + violationId, tr("QC violation resolved.", "تمت معالجة مخالفة QC."));
  }

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>{tr("QC Material", "مادة QC")}</h2>
      <form className="catalog-form" onSubmit={createMaterial}>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Level", "المستوى")}<input name="levelName" placeholder={tr("Level 1 / Normal", "المستوى 1 / طبيعي")} required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Manufacturer", "الشركة المصنعة")}<input name="manufacturer" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "material" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Material", "إنشاء مادة QC")}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("QC Lot", "تشغيلة QC")}</h2>
      <form className="catalog-form" onSubmit={createLot}>
        <label className="form-span">{tr("Material", "المادة")}<select name="materialId" required defaultValue="">
          <option value="">{tr("Select material…", "اختر المادة…")}</option>
          {materials.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)} · {item.levelName}</option>)}
        </select></label>
        <label>{tr("Lot number", "رقم التشغيلة")}<input name="lotNumber" required /></label>
        <label>{tr("Received", "تاريخ الاستلام")}<input name="receivedAt" type="date" /></label>
        <label>{tr("Opened", "تاريخ الفتح")}<input name="openedAt" type="date" /></label>
        <label>{tr("Expiry", "تاريخ الانتهاء")}<input name="expiryDate" type="date" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "lot" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Lot", "إنشاء تشغيلة QC")}</button>
      </form>
    </article>}

    {canManage && <article className="detail-card">
      <h2>{tr("QC Target & Westgard Rules", "هدف QC وقواعد Westgard")}</h2>
      <form className="catalog-form" onSubmit={createTarget}>
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
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <div className="form-span">
          <strong>{tr("Westgard rules", "قواعد Westgard")}</strong>
          <div className="result-actions">
            {["1:2s","1:3s","2:2s","R:4s","4:1s","10x"].map(rule => <label className="check-line" key={rule}>
              <input type="checkbox" name={"rule-" + rule} defaultChecked={rule !== "10x"} /> {rule}
            </label>)}
          </div>
        </div>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "target" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create QC Target", "إنشاء هدف QC")}</button>
      </form>
    </article>}

    {canEnter && <article className="detail-card">
      <h2>{tr("Enter QC Run", "إدخال تشغيل QC")}</h2>
      <p className="muted">{tr(
        "Enter multiple control levels in the same run when available so multi-level rules such as R:4s are evaluated within the same QC event.",
        "أدخل عدة مستويات ضبط ضمن نفس التشغيل عند توفرها، حتى تُقيّم القواعد متعددة المستويات مثل R:4s ضمن حدث QC نفسه.",
      )}</p>
      <form className="catalog-form" onSubmit={createRun}>
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
      </form>
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

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
