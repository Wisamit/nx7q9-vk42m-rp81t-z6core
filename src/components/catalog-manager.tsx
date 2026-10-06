"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiLocale } from "@/components/ui-locale-provider";
import { enumLabel } from "@/lib/ui-i18n";

type Option = { id: string; code: string; nameEn?: string | null; symbol?: string };

export function CatalogManager({ departments, specimens, containers, methods, units }: { departments: Option[]; specimens: Option[]; containers: Option[]; methods: Option[]; units: Option[] }) {
  const router = useRouter();
  const { locale, t } = useUiLocale();
  const [mode, setMode] = useState<"test" | "master" | null>(null);
  const [masterType, setMasterType] = useState("departments");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...data, decimalPrecision: data.decimalPrecision ? Number(data.decimalPrecision) : null, tatMinutes: data.tatMinutes ? Number(data.tatMinutes) : null };
    const response = await fetch("/api/catalog/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (response.ok) { setMode(null); router.refresh(); } else setMessage(t("Could not create the test. Check the code and required fields.", "تعذر إنشاء الفحص. تحقق من الرمز والحقول المطلوبة."));
    setSaving(false);
  }

  async function saveMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/catalog/master-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, type: masterType }) });
    if (response.ok) { setMode(null); router.refresh(); } else setMessage(t("Could not create the item. The code may already exist.", "تعذر إنشاء العنصر. قد يكون الرمز مستخدمًا مسبقًا."));
    setSaving(false);
  }

  return <div className="catalog-actions">
    <button className="secondary-button" onClick={() => { setMode("master"); setMessage(""); }}>{t("Add Master Data", "إضافة بيانات أساسية")}</button>
    <button className="primary-button" onClick={() => { setMode("test"); setMessage(""); }}>{t("Add Test", "إضافة فحص")}</button>
    {mode && <div className="modal-backdrop" onMouseDown={() => setMode(null)}><section className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">{t("Test Catalog", "دليل الفحوصات")}</p><h2>{mode === "test" ? t("Create Test", "إنشاء فحص") : t("Add Master Data", "إضافة بيانات أساسية")}</h2></div><button className="icon-button" onClick={() => setMode(null)}>×</button></div>
      {mode === "test" ? <form className="catalog-form" onSubmit={saveTest}>
        <label>{t("Test code", "رمز الفحص")}<input name="code" required placeholder={t("e.g. GLU", "مثال: GLU")} /></label>
        <label>{t("English name", "الاسم بالإنجليزية")}<input name="nameEn" required placeholder={t("e.g. Glucose", "مثال: Glucose")} /></label>
        <label>{t("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{t("Abbreviation", "الاختصار")}<input name="abbreviation" /></label>
        <label>{t("Result type", "نوع النتيجة")}<select name="resultType" defaultValue="NUMERIC">{["NUMERIC","TEXT","QUALITATIVE","BOOLEAN","DATE"].map(value=><option key={value} value={value}>{enumLabel(locale,value)}</option>)}</select></label>
        <label>{t("Workflow", "مسار العمل")}<select name="workflowType" defaultValue="GENERAL"><option value="GENERAL">{t("General laboratory", "مختبر عام")}</option><option value="MICROBIOLOGY">{t("Microbiology / culture", "أحياء دقيقة / زرع")}</option></select></label>
        <label>{t("Department", "القسم")}<select name="departmentId"><option value="">—</option>{departments.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>{t("Specimen", "العينة")}<select name="specimenTypeId"><option value="">—</option>{specimens.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>{t("Container / tube", "الحاوية / الأنبوب")}<select name="containerId"><option value="">—</option>{containers.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>{t("Method", "الطريقة")}<select name="methodId"><option value="">—</option>{methods.map(x => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</select></label>
        <label>{t("Default unit", "الوحدة الافتراضية")}<select name="defaultUnitId"><option value="">—</option>{units.map(x => <option key={x.id} value={x.id}>{x.symbol || x.code}</option>)}</select></label>
        <label>{t("Decimal precision", "المنازل العشرية")}<input name="decimalPrecision" type="number" min="0" max="8" /></label>
        <label>{t("TAT minutes", "مدة الإنجاز بالدقائق")}<input name="tatMinutes" type="number" min="0" /></label>
        <label>{t("LOINC code", "رمز LOINC")}<input name="loincCode" /></label>
        {message && <p className="form-error form-span">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? t("Saving…", "جارٍ الحفظ…") : t("Create Test", "إنشاء الفحص")}</button>
      </form> : <form className="catalog-form" onSubmit={saveMaster}>
        <label>{t("Type", "النوع")}<select value={masterType} onChange={e => setMasterType(e.target.value)}><option value="departments">{t("Department", "قسم")}</option><option value="specimens">{t("Specimen Type", "نوع عينة")}</option><option value="containers">{t("Container / Tube", "حاوية / أنبوب")}</option><option value="methods">{t("Method", "طريقة")}</option><option value="units">{t("Unit", "وحدة")}</option></select></label>
        <label>{t("Code", "الرمز")}<input name="code" required /></label><label>{t("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label><label>{t("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        {masterType === "units" && <><label>{t("Symbol", "الرمز الظاهر")}<input name="symbol" required /></label><label>{t("UCUM code", "رمز UCUM")}<input name="ucumCode" /></label></>}
        {masterType === "containers" && <><label>{t("Tube color", "لون الأنبوب")}<input name="tubeColor" /></label><label>{t("Additive", "المادة المضافة")}<input name="additive" /></label></>}
        {message && <p className="form-error form-span">{message}</p>}<button className="primary-button form-span" disabled={saving}>{saving ? t("Saving…", "جارٍ الحفظ…") : t("Add Item", "إضافة العنصر")}</button>
      </form>}
    </section></div>}
  </div>;
}
