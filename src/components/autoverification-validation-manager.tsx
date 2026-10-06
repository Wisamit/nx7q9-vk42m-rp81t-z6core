"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };

export function AutoverificationValidationManager({
  tests,
  branches,
  locale,
}: {
  tests: Option[];
  branches: Branch[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [condition, setCondition] = useState("ALWAYS");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("policy");
    setMessage("");

    const response = await fetch("/api/clinical-rules/autoverification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        branchId: form.get("branchId"),
        enabled: form.get("enabled") === "on",
        allowManual: form.get("allowManual") === "on",
        allowAnalyzer: form.get("allowAnalyzer") === "on",
        allowImport: form.get("allowImport") === "on",
        requireAllFlagsNormal: form.get("requireAllFlagsNormal") === "on",
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    setMessage(response.ok ? tr("Autoverification policy created.", "تم إنشاء سياسة التحقق الآلي.") : tr("Could not create autoverification policy.", "تعذر إنشاء سياسة التحقق الآلي."));
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  async function createHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("hold");
    setMessage("");

    const response = await fetch("/api/clinical-rules/validation-holds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        branchId: form.get("branchId"),
        condition,
        resultSource: condition === "RESULT_SOURCE" ? form.get("resultSource") : null,
        severity: form.get("severity"),
        reasonEn: form.get("reasonEn"),
        reasonAr: form.get("reasonAr"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    setMessage(response.ok ? tr("Validation hold rule created.", "تم إنشاء قاعدة إيقاف التحقق.") : tr("Could not create validation hold rule.", "تعذر إنشاء قاعدة إيقاف التحقق."));
    setBusy("");
    if (response.ok) {
      event.currentTarget.reset();
      setCondition("ALWAYS");
      router.refresh();
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Create Autoverification Policy", "إنشاء سياسة تحقق آلي")}</h2>
      <p className="muted">{tr("Autoverification stops at VERIFIED. Critical values, exceeded delta checks, pending reflex recommendations and blocking holds are mandatory hard stops.", "يتوقف التحقق الآلي عند حالة VERIFIED. القيم الحرجة وتجاوزات Delta والتوصيات الانعكاسية المعلقة وحالات الحظر هي نقاط توقف إلزامية.")}</p>
      <form className="catalog-form" onSubmit={createPolicy}>
        <label>{tr("Test", "الفحص")}<select name="testId" required defaultValue="">
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue="">
          <option value="">{tr("All branches", "كل الفروع")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
        </select></label>
        <label><input name="enabled" type="checkbox" /> {tr("Enable policy", "تفعيل السياسة")}</label>
        <label><input name="allowManual" type="checkbox" /> {tr("Allow manual results", "السماح بالنتائج اليدوية")}</label>
        <label><input name="allowAnalyzer" type="checkbox" defaultChecked /> {tr("Allow analyzer results when QC gate permits", "السماح بنتائج الأجهزة عندما تسمح بوابة QC")}</label>
        <label><input name="allowImport" type="checkbox" /> {tr("Allow imported results", "السماح بالنتائج المستوردة")}</label>
        <label><input name="requireAllFlagsNormal" type="checkbox" /> {tr("Require all flags normal/unknown", "اشتراط أن تكون كل الإشارات طبيعية/غير معروفة")}</label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "policy"}>{busy === "policy" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Autoverification Policy", "إنشاء سياسة التحقق الآلي")}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>{tr("Create Validation Hold Rule", "إنشاء قاعدة إيقاف التحقق")}</h2>
      <p className="muted">{tr("Blocking holds stop verification until an authorized reviewer resolves them with a documented note. Warning holds remain visible but do not block.", "حالات الحظر توقف التحقق حتى يعالجها مراجع مخول مع ملاحظة موثقة، بينما تبقى التحذيرات ظاهرة من دون منع التحقق.")}</p>
      <form className="catalog-form" onSubmit={createHold}>
        <label>{tr("Test", "الفحص")}<select name="testId" required defaultValue="">
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue="">
          <option value="">{tr("All branches", "كل الفروع")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
        </select></label>
        <label>{tr("Condition", "الشرط")}<select value={condition} onChange={event => setCondition(event.target.value)}>
          <option value="ALWAYS">{tr("Always hold", "إيقاف دائم")}</option>
          <option value="RESULT_SOURCE">{tr("Result source", "مصدر النتيجة")}</option>
          <option value="ANY_ABNORMAL">{tr("Any abnormal flag", "أي إشارة غير طبيعية")}</option>
          <option value="ANY_CRITICAL">{tr("Any critical value", "أي قيمة حرجة")}</option>
          <option value="DELTA_EXCEEDED">{tr("Delta limit exceeded", "تجاوز حد Delta")}</option>
        </select></label>
        {condition === "RESULT_SOURCE" && <label>{tr("Result source", "مصدر النتيجة")}<select name="resultSource" defaultValue="MANUAL">
          <option value="MANUAL">{tr("Manual", "يدوي")}</option>
          <option value="ANALYZER">{tr("Analyzer", "جهاز")}</option>
          <option value="IMPORT">{tr("Import", "استيراد")}</option>
          <option value="CALCULATED">{tr("Calculated", "محسوبة")}</option>
        </select></label>}
        <label>{tr("Severity", "الشدة")}<select name="severity" defaultValue="BLOCK">
          <option value="BLOCK">{tr("Block verification", "منع التحقق")}</option>
          <option value="WARNING">{tr("Warning only", "تحذير فقط")}</option>
        </select></label>
        <label className="form-span">{tr("Reason (English)", "السبب بالإنجليزية")}<input name="reasonEn" required /></label>
        <label className="form-span">{tr("Reason (Arabic)", "السبب بالعربية")}<input name="reasonAr" dir="rtl" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "hold"}>{busy === "hold" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Validation Hold Rule", "إنشاء قاعدة إيقاف التحقق")}</button>
      </form>
    </article>

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
