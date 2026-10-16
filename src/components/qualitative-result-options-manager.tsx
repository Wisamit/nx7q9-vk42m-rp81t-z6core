"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  status: string;
  approvedAt: string | null;
  retiredAt: string | null;
  retirementReason: string | null;
  createdByNameEn: string;
  createdByNameAr?: string | null;
  approvedByNameEn?: string | null;
  approvedByNameAr?: string | null;
  retiredByNameEn?: string | null;
  retiredByNameAr?: string | null;
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
  canApprove,
}: {
  tests: TestOption[];
  options: ExistingOption[];
  locale: "ar" | "en";
  canApprove: boolean;
}) {
  const router = useRouter();
  const [testId, setTestId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [governance, setGovernance] = useState<{ id: string; action: "APPROVE" | "RETIRE" } | null>(null);
  const [governanceReason, setGovernanceReason] = useState("");
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
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setFormError("");
    try {
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
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not create qualitative option.", "تعذر إنشاء خيار النتيجة النوعية."));
        return;
      }
      setCreateOpen(false);
      setMessage(tr(
        "Qualitative result option draft created. It cannot be used clinically until approval.",
        "تم إنشاء مسودة خيار النتيجة النوعية. لا يمكن استخدامها سريرياً قبل الاعتماد.",
      ));
      setTestId("");
      setComponentId("");
      router.refresh();
    } catch {
      setFormError(tr("Connection error; draft creation not confirmed.", "خطأ في الاتصال؛ لم يتم تأكيد إنشاء المسودة."));
    } finally {
      setBusy("");
    }
  }

  function openGovernance(id: string, action: "APPROVE" | "RETIRE") {
    if (!canApprove || busy) return;
    setFormError("");
    setGovernanceReason("");
    setGovernance({ id, action });
  }

  async function governanceAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!governance || !canApprove || busy) return;
    const current = options.find(option => option.id === governance.id);
    if (!current || (governance.action === "APPROVE" && current.approvalStatus !== "DRAFT")
      || (governance.action === "RETIRE" && current.approvalStatus !== "APPROVED")) {
      setFormError(tr("The option state has changed. Refresh before retrying.", "تغيّرت حالة الخيار. حدّث الصفحة قبل إعادة المحاولة."));
      return;
    }
    const reason = governance.action === "RETIRE" ? governanceReason.trim() : "";
    if (governance.action === "RETIRE" && !reason) {
      setFormError(tr("Retirement reason is required.", "سبب الإيقاف مطلوب."));
      return;
    }
    setBusy(current.id);
    setFormError("");
    try {
      const response = await fetch("/api/clinical-rules/qualitative-options", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, action: governance.action, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error === "approved_qualitative_option_overlap"
          ? tr("Approval blocked: another approved version with the same code overlaps this effective period.",
            "تعذر الاعتماد: يوجد إصدار معتمد آخر بنفس الرمز ويتداخل مع فترة السريان.")
          : body.error || tr("Could not update qualitative option.", "تعذر تحديث خيار النتيجة النوعية."));
        return;
      }
      setMessage(governance.action === "APPROVE"
        ? tr("Qualitative option approved for clinical use.", "تم اعتماد خيار النتيجة النوعية للاستخدام السريري.")
        : tr("Qualitative option retired.", "تم إيقاف خيار النتيجة النوعية."));
      setGovernance(null);
      setGovernanceReason("");
      router.refresh();
    } catch {
      setFormError(tr("Connection error; action was not confirmed.", "خطأ في الاتصال؛ لم يتم تأكيد الإجراء."));
    } finally {
      setBusy("");
    }
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
          "Configure selectable qualitative values per test/component. New meanings are saved as inactive drafts; only explicitly approved options can be used clinically. The selected label, flag and critical state are snapshotted into the result.",
          "هيّئ القيم النوعية القابلة للاختيار لكل فحص/مكوّن. تُحفظ المعاني الجديدة كمسودات غير نشطة، ولا تُستخدم سريرياً إلا بعد اعتماد صريح. ويتم حفظ نسخة تاريخية من النص والإشارة والحالة الحرجة داخل النتيجة."
        )}</p>
      </div>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
        onClick={() => { setFormError(""); setMessage(""); setCreateOpen(true); }}>
        {tr("Create Qualitative Option Draft", "إنشاء مسودة خيار نوعي")}
      </button>
    </div>

    <CrudModal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }}
      size="compact"
      title={tr("Create Qualitative Option Draft", "إنشاء مسودة خيار نتيجة نوعية")}
      description={tr(
        "Clinical meanings remain inactive drafts until separately approved. Critical and abnormal flags need a qualified reviewer.",
        "تبقى معاني النتائج مسودات غير فعالة حتى اعتمادها بشكل منفصل؛ تتطلب إشارات الخطورة مراجعاً مؤهلاً.",
      )}>
    {createOpen && <form className="catalog-form" onSubmit={createOption}>
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
      <label>{tr("Value (English)", "القيمة بالإنجليزية")}<input name="valueEn" required placeholder={tr("Positive", "إيجابي")} /></label>
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
      <label>{tr("Effective from (choose intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<input name="effectiveFrom" type="date" required /></label>
      <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
      <label className="checkbox-row"><input name="isAbnormal" type="checkbox" /> {tr("Treat this option as abnormal", "اعتبر هذا الخيار غير طبيعي")}</label>
      <label className="checkbox-row"><input name="isCritical" type="checkbox" /> {tr("Treat this option as a critical result", "اعتبر هذا الخيار نتيجة حرجة")}</label>
      <button className="primary-button form-span" disabled={busy === "create" || !testId || (requiresComponent && !componentId)}>
        {busy === "create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Qualitative Option Draft", "إنشاء مسودة الخيار النوعي")}
      </button>
      {formError && <p className="form-error form-span" role="alert">{formError}</p>}
    </form>}
    </CrudModal>

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
          <th>{tr("Governance", "الحوكمة")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th>{tr("Action", "الإجراء")}</th>
        </tr></thead>
        <tbody>
          {options.length === 0 ? <tr><td colSpan={10} className="empty-state">{tr("No qualitative result options configured.", "لا توجد خيارات نتائج نوعية مهيأة.")}</td></tr> :
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
                <td>
                  <strong>{option.approvalStatus === "APPROVED" ? tr("Approved", "معتمد") : option.approvalStatus === "RETIRED" ? tr("Retired", "موقوف") : tr("Draft", "مسودة")}</strong>
                  <br/><small>{tr("Created by", "أُنشئ بواسطة")}: {locale === "ar" ? option.createdByNameAr || option.createdByNameEn : option.createdByNameEn}</small>
                  {option.approvedAt && option.approvedByNameEn ? <><br/><small>{tr("Approved by", "اعتمد بواسطة")}: {locale === "ar" ? option.approvedByNameAr || option.approvedByNameEn : option.approvedByNameEn} · {option.approvedAt}</small></> : null}
                  {option.retiredAt && option.retiredByNameEn ? <><br/><small>{tr("Retired by", "أُوقف بواسطة")}: {locale === "ar" ? option.retiredByNameAr || option.retiredByNameEn : option.retiredByNameEn} · {option.retiredAt}</small></> : null}
                  {option.retirementReason ? <><br/><small>{tr("Reason", "السبب")}: {option.retirementReason}</small></> : null}
                </td>
                <td>{option.status}</td>
                <td>{canApprove && option.approvalStatus === "DRAFT"
                  ? <button type="button" className="primary-button" disabled={busy === option.id} onClick={() => openGovernance(option.id, "APPROVE")}>{tr("Approve", "اعتماد")}</button>
                  : canApprove && option.approvalStatus === "APPROVED"
                    ? <button type="button" className="secondary-button" disabled={busy === option.id} onClick={() => openGovernance(option.id, "RETIRE")}>{tr("Retire", "إيقاف")}</button>
                    : "—"}</td>
              </tr>;
            })}
        </tbody>
      </table>
    </div>
    <CrudModal open={governance !== null} onClose={() => { if (!busy) setGovernance(null); }}
      size="compact"
      title={governance?.action === "APPROVE"
        ? tr("Approve Qualitative Clinical Meaning", "اعتماد معنى نتيجة نوعية سريرياً")
        : tr("Retire Qualitative Clinical Meaning", "إيقاف معنى نتيجة نوعية")}
      description={tr(
        "This governed change may alter which qualitative labels trigger clinical flags. The existing approved history remains traceable.",
        "قد يغيّر هذا الإجراء المحكوم المعاني التي تُنشئ إشارات سريرية. يبقى سجل النسخ المعتمدة قابلاً للتتبع.",
      )}>
      {governance && <form className="catalog-form" onSubmit={governanceAction}>
        <p className="form-span">{tr(
          "Review the selected result meaning and its clinical flags before confirming.",
          "راجع معنى النتيجة المحدد وإشاراته السريرية قبل التأكيد.",
        )}</p>
        {(() => {
          const current = options.find(option => option.id === governance.id);
          if (!current) return <p className="form-error form-span" role="alert">{tr("Option unavailable.", "الخيار غير متاح.")}</p>;
          return <div className="form-span">
            <strong>{current.testCode} · {current.code}</strong>
            <p>{locale === "ar" ? current.valueAr || current.valueEn : current.valueEn}</p>
            <p>{flagLabel(current.flag)} · {current.isCritical
              ? tr("Critical flag", "إشارة حرجة")
              : tr("Non-critical", "غير حرج")}</p>
          </div>;
        })()}
        {governance.action === "RETIRE" && <label className="form-span">
          {tr("Reason for retirement (required)", "سبب الإيقاف (مطلوب)")}
          <textarea rows={3} value={governanceReason} maxLength={1000} required
            onChange={event => setGovernanceReason(event.target.value)} />
        </label>}
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : governance.action === "APPROVE"
            ? tr("Confirm Clinical Approval", "تأكيد الاعتماد السريري")
            : tr("Confirm Retirement", "تأكيد الإيقاف")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
