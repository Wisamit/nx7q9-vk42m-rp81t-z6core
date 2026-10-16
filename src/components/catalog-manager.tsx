"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Option = { id: string; code: string; nameEn?: string | null; nameAr?: string | null; symbol?: string };

export function CatalogManager({ departments, specimens, containers, methods, units, locale }: { departments: Option[]; specimens: Option[]; containers: Option[]; methods: Option[]; units: Option[]; locale: "ar" | "en" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"test" | "master" | null>(null);
  const [masterType, setMasterType] = useState("departments");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const optionName = (x: Option) => locale === "ar" ? x.nameAr || x.nameEn || x.code : x.nameEn || x.code;

  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...data,
      decimalPrecision: data.decimalPrecision ? Number(data.decimalPrecision) : null,
      tatMinutes: data.tatMinutes ? Number(data.tatMinutes) : null };
    try {
      const response = await fetch("/api/catalog/tests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr("Could not create the test. Check the code and required fields.",
          "تعذر إنشاء الفحص. تحقق من الرمز والحقول المطلوبة."));
        return;
      }
      setMode(null);
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Verify the test code before retrying.",
        "انقطع الاتصال؛ تحقق من رمز الفحص قبل إعادة المحاولة."));
    } finally {
      setSaving(false);
    }
  }

  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/catalog/master-data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, type: masterType }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr("Could not create the item. The code may already exist.",
          "تعذر إنشاء العنصر. قد يكون الرمز مستخدمًا مسبقًا."));
        return;
      }
      setMode(null);
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Check master records before retrying.",
        "انقطع الاتصال؛ تحقق من السجلات المرجعية قبل إعادة المحاولة."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="catalog-actions">
    <button type="button" disabled={saving} className="secondary-button" onClick={() => { setMode("master"); setMessage(""); }}>{tr("Add Master Data", "إضافة بيانات رئيسية")}</button>
    <button type="button" disabled={saving} className="primary-button" onClick={() => { setMode("test"); setMessage(""); }}>{tr("Add Test", "إضافة فحص")}</button>
    <CrudModal open={mode !== null} onClose={() => { if (!saving) setMode(null); }}
      size="compact"
      title={mode === "test" ? tr("Create Test", "إنشاء فحص") : tr("Add Master Data", "إضافة بيانات رئيسية")}
      description={tr(
        "Clinical test catalog and master data are configuration-driven; review precise codes, units, specimen and test workflow before saving.",
        "دليل الفحوصات والبيانات المرجعية قابلان للتهيئة؛ راجع الرموز والوحدات ونوع العينة ومسار الفحص قبل الحفظ.",
      )}>
      {mode === "test" ? <form className="catalog-form" onSubmit={saveTest}>
        <label>{tr("Test code", "رمز الفحص")}<input name="code" required placeholder={tr("e.g. GLU", "مثال: GLU")} /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required placeholder={tr("e.g. Glucose", "مثال: Glucose")} /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Abbreviation", "الاختصار")}<input name="abbreviation" /></label>
        <label>{tr("Result type", "نوع النتيجة")}<select name="resultType" defaultValue="NUMERIC"><option value="NUMERIC">{tr("Numeric", "رقمية")}</option><option value="TEXT">{tr("Text", "نصية")}</option><option value="QUALITATIVE">{tr("Qualitative", "نوعية")}</option><option value="BOOLEAN">{tr("Boolean", "نعم / لا")}</option><option value="DATE">{tr("Date", "تاريخ")}</option></select></label>
        <label>{tr("Workflow", "مسار العمل")}<select name="workflowType" defaultValue="GENERAL"><option value="GENERAL">{tr("General laboratory", "مختبر عام")}</option><option value="MICROBIOLOGY">{tr("Microbiology / culture", "الأحياء الدقيقة / الزراعة")}</option></select></label>
        <label>{tr("Department", "القسم")}<select name="departmentId"><option value="">—</option>{departments.map(x => <option key={x.id} value={x.id}>{optionName(x)}</option>)}</select></label>
        <label>{tr("Specimen", "العينة")}<select name="specimenTypeId"><option value="">—</option>{specimens.map(x => <option key={x.id} value={x.id}>{optionName(x)}</option>)}</select></label>
        <label>{tr("Container / tube", "الحاوية / الأنبوب")}<select name="containerId"><option value="">—</option>{containers.map(x => <option key={x.id} value={x.id}>{optionName(x)}</option>)}</select></label>
        <label>{tr("Method", "الطريقة")}<select name="methodId"><option value="">—</option>{methods.map(x => <option key={x.id} value={x.id}>{optionName(x)}</option>)}</select></label>
        <label>{tr("Default unit", "الوحدة الافتراضية")}<select name="defaultUnitId"><option value="">—</option>{units.map(x => <option key={x.id} value={x.id}>{x.symbol || x.code}</option>)}</select></label>
        <label>{tr("Decimal precision", "عدد المنازل العشرية")}<input name="decimalPrecision" type="number" min="0" max="8" /></label>
        <label>{tr("TAT minutes", "زمن الإنجاز بالدقائق")}<input name="tatMinutes" type="number" min="0" /></label>
        <label>{tr("LOINC code", "رمز LOINC")}<input name="loincCode" /></label>
        {message && <p className="form-error form-span" role="alert">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Test", "إنشاء الفحص")}</button>
      </form> : mode === "master" ? <form className="catalog-form" onSubmit={saveMaster}>
        <label>{tr("Type", "النوع")}<select value={masterType} onChange={e => setMasterType(e.target.value)}><option value="departments">{tr("Department", "قسم")}</option><option value="specimens">{tr("Specimen Type", "نوع عينة")}</option><option value="containers">{tr("Container / Tube", "حاوية / أنبوب")}</option><option value="methods">{tr("Method", "طريقة")}</option><option value="units">{tr("Unit", "وحدة")}</option></select></label>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label><label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label><label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        {masterType === "units" && <><label>{tr("Symbol", "الرمز المختصر")}<input name="symbol" required /></label><label>{tr("UCUM code", "رمز UCUM")}<input name="ucumCode" /></label></>}
        {masterType === "containers" && <><label>{tr("Tube color", "لون الأنبوب")}<input name="tubeColor" /></label><label>{tr("Additive", "المادة المضافة")}<input name="additive" /></label></>}
        {message && <p className="form-error form-span">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Item", "إضافة العنصر")}</button>
      </form> : null}
    </CrudModal>
  </div>;
}
