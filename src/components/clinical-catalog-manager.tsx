"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Unit = { id: string; code: string; symbol: string };
type Method = { id: string; nameEn: string; nameAr?: string | null };
type Branch = { id: string; nameEn: string; nameAr?: string | null };
type SpecimenType = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Analyzer = { id: string; code: string; name: string; branchId: string; branchNameEn: string; branchNameAr?: string | null };
type Component = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Test = { id: string; code: string; nameEn: string; nameAr?: string | null; components: Component[] };

export function ClinicalCatalogManager({
  tests,
  units,
  methods,
  branches,
  specimenTypes,
  analyzers,
  locale,
}: {
  tests: Test[];
  units: Unit[];
  methods: Method[];
  branches: Branch[];
  specimenTypes: SpecimenType[];
  analyzers: Analyzer[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"component" | "panel" | "range" | "tat" | null>(null);
  const [testId, setTestId] = useState(tests[0]?.id || "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const components = tests.find(t => t.id === testId)?.components || [];
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const name = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  async function send(event: FormEvent<HTMLFormElement>, url: string, extra: Record<string, unknown> = {}) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const body = { ...raw, ...extra };
    ["decimalPrecision", "displayOrder"].forEach(key => {
      if (body[key as keyof typeof body] !== "") (body as Record<string, unknown>)[key] = Number(body[key as keyof typeof body]);
    });
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) { setMode(null); router.refresh(); }
    else setMessage(tr("Could not save. Review the values and try again.", "تعذر الحفظ. راجع القيم وحاول مرة أخرى."));
    setSaving(false);
  }

  return <div className="catalog-actions">
    <button className="secondary-button" onClick={() => setMode("component")}>{tr("Add Component", "إضافة مكوّن")}</button>
    <button className="secondary-button" onClick={() => setMode("panel")}>{tr("Add Panel / Profile", "إضافة باقة / ملف")}</button>
    <button className="secondary-button" onClick={() => setMode("range")}>{tr("Add Reference Range", "إضافة مجال مرجعي")}</button>
    <button className="secondary-button" onClick={() => setMode("tat")}>{tr("Add TAT / SLA Policy", "إضافة سياسة TAT / SLA")}</button>

    {mode && <div className="modal-backdrop" onMouseDown={() => setMode(null)}><section className="modal-card" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">{tr("Clinical Configuration", "الإعدادات السريرية")}</p><h2>{
        mode === "component" ? tr("Test Component", "مكوّن الفحص") :
        mode === "panel" ? tr("Panel / Profile", "الباقة / الملف") :
        mode === "tat" ? tr("TAT / SLA Policy", "سياسة TAT / SLA") :
        tr("Reference Range & Critical Limits", "المجال المرجعي والحدود الحرجة")
      }</h2></div><button className="icon-button" onClick={() => setMode(null)}>×</button></div>

      {mode === "component" && <form className="catalog-form" onSubmit={e => send(e, "/api/catalog/components")}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={testId} onChange={e => setTestId(e.target.value)}>{tests.map(t => <option key={t.id} value={t.id}>{t.code} — {name(t)}</option>)}</select></label>
        <label>{tr("Component code", "رمز المكوّن")}<input name="code" required /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Result type", "نوع النتيجة")}<select name="resultType"><option value="NUMERIC">{tr("Numeric", "رقمية")}</option><option value="TEXT">{tr("Text", "نصية")}</option><option value="QUALITATIVE">{tr("Qualitative", "نوعية")}</option><option value="BOOLEAN">{tr("Boolean", "نعم / لا")}</option><option value="DATE">{tr("Date", "تاريخ")}</option></select></label>
        <label>{tr("Unit", "الوحدة")}<select name="unitId"><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.symbol} ({u.code})</option>)}</select></label>
        <label>{tr("Decimal precision", "عدد المنازل العشرية")}<input name="decimalPrecision" type="number" min="0" max="8" /></label>
        <label>{tr("Display order", "ترتيب العرض")}<input name="displayOrder" type="number" min="0" defaultValue="0" /></label>
        {message && <p className="form-error form-span">{message}</p>}
        <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Component", "حفظ المكوّن")}</button>
      </form>}

      {mode === "panel" && <form className="catalog-form" onSubmit={e => {
        const form = e.currentTarget;
        const ids = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="testIds"]:checked')).map(x => x.value);
        void send(e, "/api/catalog/panels", { testIds: ids });
      }}>
        <label>{tr("Panel code", "رمز الباقة")}<input name="code" required /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <fieldset className="test-picker form-span"><legend>{tr("Included tests", "الفحوصات المشمولة")}</legend>{tests.map(t => <label key={t.id} className="check-row"><input type="checkbox" name="testIds" value={t.id} /><span>{t.code} — {name(t)}</span></label>)}</fieldset>
        {message && <p className="form-error form-span">{message}</p>}
        <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Panel / Profile", "حفظ الباقة / الملف")}</button>
      </form>}

      {mode === "tat" && <form className="catalog-form" onSubmit={e => send(e, "/api/catalog/tat-policies")}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={testId} onChange={e => setTestId(e.target.value)}>{tests.map(t => <option key={t.id} value={t.id}>{t.code} — {name(t)}</option>)}</select></label>
        <label>{tr("Branch scope", "نطاق الفرع")}<select name="branchId"><option value="">{tr("Organization default / any branch", "افتراضي المؤسسة / كل الفروع")}</option>{branches.map(b => <option key={b.id} value={b.id}>{name(b)}</option>)}</select></label>
        <label>{tr("Priority scope", "نطاق الأولوية")}<select name="priority"><option value="ANY">{tr("Any priority", "كل الأولويات")}</option><option value="ROUTINE">{tr("Routine", "عادي")}</option><option value="URGENT">{tr("Urgent", "عاجل")}</option><option value="STAT">{tr("STAT", "STAT")}</option></select></label>
        <label>{tr("TAT minutes", "زمن الإنجاز بالدقائق")}<input name="tatMinutes" type="number" min="0" max="5256000" required /></label>
        <label>{tr("Alert before due (minutes)", "التنبيه قبل الاستحقاق (دقائق)")}<input name="alertBeforeMinutes" type="number" min="0" placeholder={tr("Optional", "اختياري")} /></label>
        <label>{tr("Escalate after overdue (minutes)", "التصعيد بعد التأخر (دقائق)")}<input name="escalationAfterMinutes" type="number" min="0" placeholder={tr("Optional — leave blank to disable", "اختياري — اتركه فارغاً للتعطيل")} /></label>
        <label>{tr("Repeat escalation every (minutes)", "تكرار التصعيد كل (دقائق)")}<input name="escalationRepeatMinutes" type="number" min="1" placeholder={tr("Required only for multiple levels", "مطلوب فقط عند تعدد المستويات")} /></label>
        <label>{tr("Maximum escalation level", "الحد الأقصى لمستوى التصعيد")}<input name="maxEscalationLevel" type="number" min="1" max="10" defaultValue="1" /></label>
        <label>{tr("Recipient permission code", "رمز صلاحية المستلمين")}<input name="escalationPermissionCode" maxLength={120} placeholder={tr("Permission code, e.g. results.verify", "رمز الصلاحية، مثال results.verify")} /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <p className="muted form-span">{tr(
          "New policies are saved as inactive drafts. After approval, resolution priority is exact branch + exact priority, branch default, organization priority, then organization default. TAT and escalation settings are snapshotted on the order item.",
          "تُحفظ السياسات الجديدة كمسودات غير نشطة. بعد الاعتماد تكون أولوية الاختيار: الفرع والأولوية المطابقان، ثم افتراضي الفرع، ثم أولوية المؤسسة، ثم افتراضي المؤسسة. ويتم حفظ إعدادات TAT والتصعيد كلقطة تاريخية على الفحص المطلوب."
        )}</p>
        {message && <p className="form-error form-span">{message}</p>}
        <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Save TAT / SLA Draft", "حفظ مسودة TAT / SLA")}</button>
      </form>}

      {mode === "range" && <form className="catalog-form" onSubmit={e => send(e, "/api/catalog/reference-intervals")}>
        <label>{tr("Test", "الفحص")}<select value={testId} onChange={e => setTestId(e.target.value)}>{tests.map(t => <option key={t.id} value={t.id}>{t.code} — {name(t)}</option>)}</select></label>
        <label>{tr("Component", "المكوّن")}<select name="componentId" required><option value="">{tr("Select component", "اختر المكوّن")}</option>{components.map(x => <option key={x.id} value={x.id}>{x.code} — {name(x)}</option>)}</select></label>
        <label>{tr("Sex", "الجنس")}<select name="sex"><option value="ANY">{tr("Any", "أي")}</option><option value="MALE">{tr("Male", "ذكر")}</option><option value="FEMALE">{tr("Female", "أنثى")}</option></select></label>
        <label>{tr("Age unit", "وحدة العمر")}<select name="ageUnit"><option value="">{tr("Any age", "أي عمر")}</option><option value="DAY">{tr("Day", "يوم")}</option><option value="WEEK">{tr("Week", "أسبوع")}</option><option value="MONTH">{tr("Month", "شهر")}</option><option value="YEAR">{tr("Year", "سنة")}</option></select></label>
        <label>{tr("Age from", "العمر من")}<input name="ageFrom" inputMode="decimal" /></label>
        <label>{tr("Age to", "العمر إلى")}<input name="ageTo" inputMode="decimal" /></label>
        <label>{tr("Normal low", "الحد الطبيعي الأدنى")}<input name="lowValue" inputMode="decimal" /></label>
        <label>{tr("Normal high", "الحد الطبيعي الأعلى")}<input name="highValue" inputMode="decimal" /></label>
        <label>{tr("Critical low", "الحد الحرج الأدنى")}<input name="criticalLow" inputMode="decimal" /></label>
        <label>{tr("Critical high", "الحد الحرج الأعلى")}<input name="criticalHigh" inputMode="decimal" /></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId"><option value="">{tr("Organization default", "افتراضي المؤسسة")}</option>{branches.map(b => <option key={b.id} value={b.id}>{name(b)}</option>)}</select></label>
        <label>{tr("Method", "الطريقة")}<select name="methodId"><option value="">{tr("Any / default method", "أي طريقة / الافتراضية")}</option>{methods.map(m => <option key={m.id} value={m.id}>{name(m)}</option>)}</select></label>
        <label>{tr("Analyzer", "الجهاز")}<select name="analyzerId"><option value="">{tr("Any analyzer", "أي جهاز")}</option>{analyzers.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name} · {locale === "ar" ? a.branchNameAr || a.branchNameEn : a.branchNameEn}</option>)}</select></label>
        <label>{tr("Specimen type", "نوع العينة")}<select name="specimenTypeId"><option value="">{tr("Any specimen", "أي عينة")}</option>{specimenTypes.map(x => <option key={x.id} value={x.id}>{x.code} — {name(x)}</option>)}</select></label>
        <label>{tr("Pregnancy context", "سياق الحمل")}<select name="pregnancyStatus"><option value="ANY">{tr("Any / not restricted", "أي حالة / غير مقيّد")}</option><option value="NOT_PREGNANT">{tr("Not pregnant", "غير حامل")}</option><option value="PREGNANT">{tr("Pregnant", "حامل")}</option></select></label>
        <label>{tr("Gestational age from (weeks)", "عمر الحمل من (أسابيع)")}<input name="gestationalAgeFromWeeks" inputMode="decimal" /></label>
        <label>{tr("Gestational age to (weeks)", "عمر الحمل إلى (أسابيع)")}<input name="gestationalAgeToWeeks" inputMode="decimal" /></label>
        <label>{tr("Population code", "رمز المجموعة المرجعية")}<input name="populationCode" maxLength={80} placeholder={tr("Optional configured code", "رمز اختياري مُهيأ")} /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>{tr("Source", "المصدر")}<input name="source" /></label>
        <p className="muted form-span">{tr(
          "New reference intervals are saved as inactive drafts. They cannot affect result flags or critical alerts until an authorized user explicitly approves them.",
          "تُحفظ المديات المرجعية الجديدة كمسودات غير نشطة، ولا يمكن أن تؤثر في إشارات النتائج أو التنبيهات الحرجة حتى يعتمدها مستخدم مخول صراحةً."
        )}</p>
        <label>{tr("Normal text (EN)", "النص الطبيعي (EN)")}<input name="normalTextEn" /></label>
        <label>{tr("Normal text (AR)", "النص الطبيعي (AR)")}<input name="normalTextAr" dir="rtl" /></label>
        {message && <p className="form-error form-span">{message}</p>}
        <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Reference Range Draft", "حفظ مسودة المجال المرجعي")}</button>
      </form>}
    </section></div>}
  </div>;
}
