"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ComponentOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  resultType: string;
};

type TestOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  resultType: string;
  components: ComponentOption[];
};

type ExistingOption = {
  id: string;
  testId: string;
  componentId: string | null;
  code: string;
  valueEn: string;
  valueAr?: string | null;
  flag: string;
  isAbnormal: boolean;
  isCritical: boolean;
  displayOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  testCode: string;
  testNameEn: string;
  testNameAr?: string | null;
  componentCode?: string | null;
  componentNameEn?: string | null;
  componentNameAr?: string | null;
};

export function QualitativeResultOptionsManager({
  tests,
  options,
  locale,
}: {
  tests: TestOption[];
  options: ExistingOption[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [testId, setTestId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const eligibleTests = useMemo(() => tests.filter((test) =>
    (test.components.length === 0 && test.resultType === "QUALITATIVE")
    || test.components.some((component) => component.resultType === "QUALITATIVE")
  ), [tests]);

  const selectedTest = useMemo(() => tests.find((test) => test.id === testId) || null, [tests, testId]);
  const qualitativeComponents = selectedTest?.components.filter((component) => component.resultType === "QUALITATIVE") || [];
  const requiresComponent = Boolean(selectedTest && selectedTest.components.length > 0);

  async function createOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setMessage("");

    const response = await fetch("/api/clinical-rules/qualitative-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId,
        componentId: requiresComponent ? componentId : null,
        code: form.get("code"),
        valueEn: form.get("valueEn"),
        valueAr: form.get("valueAr"),
        flag: form.get("flag"),
        isAbnormal: form.get("isAbnormal") === "on",
        isCritical: form.get("isCritical") === "on",
        displayOrder: form.get("displayOrder"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr("Qualitative result option created.", "تم إنشاء خيار النتيجة النوعية."));
      event.currentTarget.reset();
      setTestId("");
      setComponentId("");
      router.refresh();
    } else {
      setMessage(typeof body.error === "string" ? body.error : tr("Could not create qualitative option.", "تعذر إنشاء خيار النتيجة النوعية."));
    }
    setBusy("");
  }

  async function changeStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    setBusy(id);
    setMessage("");
    const response = await fetch("/api/clinical-rules/qualitative-options", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok
      ? tr("Qualitative option status updated.", "تم تحديث حالة خيار النتيجة النوعية.")
      : typeof body.error === "string" ? body.error : tr("Could not update option status.", "تعذر تحديث حالة الخيار."));
    setBusy("");
    if (response.ok) router.refresh();
  }

  const flagLabel = (flag: string) => ({
    NORMAL: tr("Normal", "طبيعي"),
    ABNORMAL: tr("Abnormal", "غير طبيعي"),
    POSITIVE: tr("Positive", "إيجابي"),
    NEGATIVE: tr("Negative", "سلبي"),
    UNKNOWN: tr("Unknown / neutral", "غير محدد / محايد"),
  }[flag] || flag);

  return <section className="detail-card detail-section">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Qualitative Result Options", "خيارات النتائج النوعية")}</h2>
        <p className="muted">{tr(
          "Configure selectable qualitative values per test/component. The selected label, flag and critical state are snapshotted into the result.",
          "هيّئ القيم النوعية القابلة للاختيار لكل فحص/مكوّن. يتم حفظ نسخة تاريخية من النص والإشارة والحالة الحرجة داخل النتيجة."
        )}</p>
      </div>
    </div>

    <form className="catalog-form" onSubmit={createOption}>
      <label>{tr("Test", "الفحص")}
        <select required value={testId} onChange={(event) => {
          setTestId(event.target.value);
          setComponentId("");
        }}>
          <option value="">{tr("Select qualitative test…", "اختر فحصًا نوعيًا…")}</option>
          {eligibleTests.map((test) => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select>
      </label>

      <label>{tr("Component", "المكوّن")}
        <select value={componentId} onChange={(event) => setComponentId(event.target.value)} disabled={!requiresComponent} required={requiresComponent}>
          <option value="">{requiresComponent ? tr("Select qualitative component…", "اختر مكوّنًا نوعيًا…") : tr("Simple test result", "نتيجة فحص بسيط")}</option>
          {qualitativeComponents.map((component) => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select>
      </label>

      <label>{tr("Code", "الرمز")}<input name="code" placeholder="POSITIVE" /></label>
      <label>{tr("Value (English)", "القيمة بالإنجليزية")}<input name="valueEn" required placeholder="Positive" /></label>
      <label>{tr("Value (Arabic)", "القيمة بالعربية")}<input name="valueAr" dir="rtl" placeholder="إيجابي" /></label>

      <label>{tr("Result flag", "إشارة النتيجة")}
        <select name="flag" defaultValue="UNKNOWN">
          <option value="UNKNOWN">{flagLabel("UNKNOWN")}</option>
          <option value="NORMAL">{flagLabel("NORMAL")}</option>
          <option value="ABNORMAL">{flagLabel("ABNORMAL")}</option>
          <option value="POSITIVE">{flagLabel("POSITIVE")}</option>
          <option value="NEGATIVE">{flagLabel("NEGATIVE")}</option>
        </select>
      </label>

      <label>{tr("Display order", "ترتيب العرض")}<input name="displayOrder" type="number" min="0" max="10000" defaultValue="0" /></label>
      <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
      <label className="checkbox-row"><input name="isAbnormal" type="checkbox" /> {tr("Treat this option as abnormal", "اعتبر هذا الخيار غير طبيعي")}</label>
      <label className="checkbox-row"><input name="isCritical" type="checkbox" /> {tr("Treat this option as a critical result", "اعتبر هذا الخيار نتيجة حرجة")}</label>
      <button className="primary-button form-span" disabled={busy === "create" || !testId || (requiresComponent && !componentId)}>
        {busy === "create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Qualitative Option", "إنشاء الخيار النوعي")}
      </button>
    </form>

    {message && <div className="form-success detail-section">{message}</div>}

    <div className="table-wrap detail-section">
      <table>
        <thead><tr>
          <th>{tr("Target", "الهدف")}</th>
          <th>{tr("Code", "الرمز")}</th>
          <th>{tr("Value", "القيمة")}</th>
          <th>{tr("Flag", "الإشارة")}</th>
          <th>{tr("Abnormal", "غير طبيعية")}</th>
          <th>{tr("Critical", "حرجة")}</th>
          <th>{tr("Effective", "السريان")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th></th>
        </tr></thead>
        <tbody>
          {options.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr("No qualitative result options configured.", "لا توجد خيارات نتائج نوعية مهيأة.")}</td></tr> :
            options.map((option) => {
              const target = option.componentId
                ? option.testCode + " / " + (option.componentCode || "")
                : option.testCode;
              const label = locale === "ar" ? option.valueAr || option.valueEn : option.valueEn;
              return <tr key={option.id}>
                <td><strong>{target}</strong><br/><small>{locale === "ar" ? option.componentNameAr || option.componentNameEn || option.testNameAr || option.testNameEn : option.componentNameEn || option.testNameEn}</small></td>
                <td>{option.code}</td>
                <td>{label}</td>
                <td>{flagLabel(option.flag)}</td>
                <td>{option.isAbnormal ? tr("YES", "نعم") : tr("NO", "لا")}</td>
                <td>{option.isCritical ? tr("YES", "نعم") : tr("NO", "لا")}</td>
                <td>{option.effectiveFrom} → {option.effectiveTo || tr("Open", "مفتوح")}</td>
                <td>{option.status}</td>
                <td><button type="button" className="secondary-button" disabled={busy === option.id} onClick={() => void changeStatus(option.id, option.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>
                  {option.status === "ACTIVE" ? tr("Deactivate", "تعطيل") : tr("Reactivate", "إعادة تفعيل")}
                </button></td>
              </tr>;
            })}
        </tbody>
      </table>
    </div>
  </section>;
}
