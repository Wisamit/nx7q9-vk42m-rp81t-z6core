"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type ComponentOption = { id: string; code: string; nameEn: string; nameAr?: string | null; resultType: string };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null; resultType: string; components: ComponentOption[] };

export function AdvancedClinicalRulesManager({ tests, branches, locale }: { tests: TestOption[]; branches: Branch[]; locale: "ar" | "en" }) {
  const router = useRouter();
  const [calcTestId, setCalcTestId] = useState("");
  const [reflexSourceTestId, setReflexSourceTestId] = useState("");
  const [reflexSourceComponentId, setReflexSourceComponentId] = useState("");
  const [reflexTargetTestId, setReflexTargetTestId] = useState("");
  const [operator, setOperator] = useState("GT");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const calcComponents = useMemo(() => tests.find(test => test.id === calcTestId)?.components || [], [tests, calcTestId]);
  const sourceTest = useMemo(() => tests.find(test => test.id === reflexSourceTestId) || null, [tests, reflexSourceTestId]);
  const sourceComponents = sourceTest?.components || [];
  const sourceComponent = sourceComponents.find(component => component.id === reflexSourceComponentId) || null;
  const sourceResultType = sourceComponent?.resultType || (sourceComponents.length === 0 ? sourceTest?.resultType : null);
  const numericOperator = ["LT","LTE","GT","GTE"].includes(operator)
    || (["EQ","NE"].includes(operator) && sourceResultType === "NUMERIC");

  async function createCalculated(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("calculated"); setMessage("");
    const response = await fetch("/api/clinical-rules/calculated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        targetComponentId: form.get("targetComponentId"),
        expression: form.get("expression"),
        decimalPrecision: form.get("decimalPrecision"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    setMessage(response.ok ? tr("Calculated result rule created.", "تم إنشاء قاعدة النتيجة المحسوبة.") : tr("Could not create calculated result rule.", "تعذر إنشاء قاعدة النتيجة المحسوبة."));
    setBusy("");
    if (response.ok) { event.currentTarget.reset(); setCalcTestId(""); router.refresh(); }
  }

  async function createReflex(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("reflex"); setMessage("");
    const response = await fetch("/api/clinical-rules/reflex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceTestId: form.get("sourceTestId"),
        sourceComponentId: form.get("sourceComponentId"),
        branchId: form.get("branchId"),
        operator,
        numericThreshold: form.get("numericThreshold"),
        textThreshold: form.get("textThreshold"),
        targetTestId: form.get("targetTestId"),
        noteEn: form.get("noteEn"),
        noteAr: form.get("noteAr"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    setMessage(response.ok ? tr("Reflex recommendation rule created.", "تم إنشاء قاعدة التوصية الانعكاسية.") : tr("Could not create reflex rule.", "تعذر إنشاء قاعدة التوصية الانعكاسية."));
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      setReflexSourceTestId("");
      setReflexSourceComponentId("");
      setReflexTargetTestId("");
      setOperator("GT");
      router.refresh();
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Create Calculated Result Rule", "إنشاء قاعدة نتيجة محسوبة")}</h2>
      <p className="muted">{tr("Uses a restricted arithmetic expression. Component codes are variables; arbitrary code execution is not allowed.", "تستخدم معادلة حسابية مقيدة، حيث تعمل رموز المكونات كمتغيرات، ولا يُسمح بتنفيذ كود عام.")}</p>
      <form className="catalog-form" onSubmit={createCalculated}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={calcTestId} onChange={event => setCalcTestId(event.target.value)}>
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>
          {tests.filter(test => test.components.length > 1).map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Target component", "المكوّن الهدف")}<select name="targetComponentId" required defaultValue="" disabled={!calcTestId}>
          <option value="">{tr("Select calculated target…", "اختر المكوّن المحسوب…")}</option>
          {calcComponents.filter(component => component.resultType === "NUMERIC").map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label className="form-span">{tr("Formula", "المعادلة")}<input name="expression" required placeholder="Example: TC - HDL - (TG / 5)" /></label>
        <p className="muted form-span">{tr("Available component codes:", "رموز المكونات المتاحة:")} {calcComponents.map(component => component.code).join(", ") || tr("Select a test first.", "اختر فحصًا أولاً.")}</p>
        <label>{tr("Decimal precision", "عدد المنازل العشرية")}<input name="decimalPrecision" type="number" min="0" max="12" defaultValue="2" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "calculated"}>{busy === "calculated" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Calculated Rule", "إنشاء القاعدة المحسوبة")}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>{tr("Create Reflex Recommendation Rule", "إنشاء قاعدة توصية انعكاسية")}</h2>
      <p className="muted">{tr("A matching result creates a recommendation for review. It does not automatically add or bill a new test.", "عند تحقق الشرط تُنشأ توصية للمراجعة فقط، ولا يُضاف أو يُفوتر فحص جديد تلقائيًا.")}</p>
      <form className="catalog-form" onSubmit={createReflex}>
        <label>{tr("Source test", "الفحص المصدر")}<select name="sourceTestId" required value={reflexSourceTestId} onChange={event => {
          setReflexSourceTestId(event.target.value);
          setReflexSourceComponentId("");
        }}>
          <option value="">{tr("Select source…", "اختر المصدر…")}</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Source component", "المكوّن المصدر")}<select name="sourceComponentId" value={reflexSourceComponentId} onChange={event => setReflexSourceComponentId(event.target.value)} disabled={!reflexSourceTestId || sourceComponents.length === 0}>
          <option value="">{sourceComponents.length ? tr("Select component…", "اختر المكوّن…") : tr("Simple test result", "نتيجة فحص بسيط")}</option>
          {sourceComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("All branches", "كل الفروع")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Operator", "المعامل")}<select value={operator} onChange={event => setOperator(event.target.value)}>
          <option value="GT">{tr("Greater than", "أكبر من")}</option><option value="GTE">{tr("Greater than or equal", "أكبر من أو يساوي")}</option><option value="LT">{tr("Less than", "أقل من")}</option><option value="LTE">{tr("Less than or equal", "أقل من أو يساوي")}</option><option value="EQ">{tr("Equals", "يساوي")}</option><option value="NE">{tr("Not equal", "لا يساوي")}</option><option value="CONTAINS">{tr("Contains text", "يحتوي على نص")}</option>
        </select></label>
        {numericOperator ? <label>{tr("Numeric threshold", "الحد الرقمي")}<input name="numericThreshold" type="number" step="0.00000001" required /></label> :
          <label>{tr("Threshold / text", "الحد / النص")}<input name="textThreshold" required /></label>}
        <label>{tr("Recommended test", "الفحص الموصى به")}<select name="targetTestId" required value={reflexTargetTestId} onChange={event => setReflexTargetTestId(event.target.value)}>
          <option value="">{tr("Select recommended test…", "اختر الفحص الموصى به…")}</option>
          {tests.filter(test => test.id !== reflexSourceTestId).map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label className="form-span">{tr("Note (English)", "الملاحظة بالإنجليزية")}<textarea name="noteEn" rows={2} /></label>
        <label className="form-span">{tr("Note (Arabic)", "الملاحظة بالعربية")}<textarea name="noteAr" rows={2} dir="rtl" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "reflex"}>{busy === "reflex" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Reflex Rule", "إنشاء قاعدة التوصية")}</button>
      </form>
    </article>
    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
