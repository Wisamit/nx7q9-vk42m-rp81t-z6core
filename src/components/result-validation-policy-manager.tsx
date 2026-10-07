"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Scope = "ORGANIZATION" | "DEPARTMENT" | "TEST";
type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Policy = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  scope: Scope;
  departmentId: string | null;
  testId: string | null;
  requiresMedicalValidation: boolean;
  allowSameReviewer: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  department?: Option | null;
  test?: Option | null;
};

export function ResultValidationPolicyManager({
  locale,
  departments,
  tests,
  policies,
}: {
  locale: "ar" | "en";
  departments: Option[];
  tests: Option[];
  policies: Policy[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("ORGANIZATION");
  const [requiresMedicalValidation, setRequiresMedicalValidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const name = (x: Option) => locale === "ar" ? x.nameAr || x.nameEn : x.nameEn;
  const sortedPolicies = useMemo(
    () => [...policies].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [policies],
  );

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = {
      scope,
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      departmentId: scope === "DEPARTMENT" ? form.get("departmentId") : null,
      testId: scope === "TEST" ? form.get("testId") : null,
      requiresMedicalValidation,
      allowSameReviewer: requiresMedicalValidation && form.get("allowSameReviewer") === "on",
      effectiveFrom: form.get("effectiveFrom"),
      effectiveTo: form.get("effectiveTo"),
    };
    const response = await fetch("/api/clinical-rules/validation-policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(body.error || tr("Could not create validation policy.", "تعذر إنشاء سياسة التحقق."));
      return;
    }
    event.currentTarget.reset();
    setRequiresMedicalValidation(false);
    setMessage(tr("Validation policy created.", "تم إنشاء سياسة التحقق."));
    router.refresh();
  }

  async function setStatus(id: string, status: "ACTIVE" | "INACTIVE") {
    if (status === "INACTIVE" && !confirm(tr(
      "Deactivate this validation policy? Existing result snapshots will remain unchanged.",
      "تعطيل سياسة التحقق؟ ستبقى لقطات النتائج التاريخية الحالية دون تغيير.",
    ))) return;
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/clinical-rules/validation-policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) setMessage(body.error || tr("Could not update validation policy.", "تعذر تحديث سياسة التحقق."));
    else router.refresh();
  }

  const scopeLabel = (value: Scope) => ({
    ORGANIZATION: tr("Organization", "المؤسسة"),
    DEPARTMENT: tr("Department", "القسم"),
    TEST: tr("Test", "الفحص"),
  }[value]);

  return <section className="detail-card detail-section">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Result Validation Paths", "مسارات التحقق من النتائج")}</h2>
        <p className="muted">{tr(
          "Technical review is always required. Medical validation can be required by organization, department, or test policy. Test overrides department, and department overrides organization.",
          "المراجعة الفنية مطلوبة دائماً. يمكن اشتراط التحقق الطبي على مستوى المؤسسة أو القسم أو الفحص. سياسة الفحص تتقدم على القسم، والقسم يتقدم على المؤسسة.",
        )}</p>
      </div>
    </div>

    <form className="catalog-form" onSubmit={createPolicy}>
      <label>{tr("Scope", "النطاق")}<select value={scope} onChange={e => setScope(e.target.value as Scope)}>
        <option value="ORGANIZATION">{scopeLabel("ORGANIZATION")}</option>
        <option value="DEPARTMENT">{scopeLabel("DEPARTMENT")}</option>
        <option value="TEST">{scopeLabel("TEST")}</option>
      </select></label>
      {scope === "DEPARTMENT" && <label>{tr("Department", "القسم")}<select name="departmentId" required>
        <option value="">{tr("Select department", "اختر القسم")}</option>
        {departments.map(x => <option key={x.id} value={x.id}>{x.code} — {name(x)}</option>)}
      </select></label>}
      {scope === "TEST" && <label>{tr("Test", "الفحص")}<select name="testId" required>
        <option value="">{tr("Select test", "اختر الفحص")}</option>
        {tests.map(x => <option key={x.id} value={x.id}>{x.code} — {name(x)}</option>)}
      </select></label>}
      <label>{tr("Policy code", "رمز السياسة")}<input name="code" required /></label>
      <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
      <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
      <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
      <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
      <label className="check-line"><input type="checkbox" checked={requiresMedicalValidation} onChange={e => setRequiresMedicalValidation(e.target.checked)} /> {tr("Require medical validation", "يتطلب تحققاً طبياً")}</label>
      {requiresMedicalValidation && <label className="check-line"><input type="checkbox" name="allowSameReviewer" /> {tr("Allow same user for technical and medical stages", "السماح لنفس المستخدم بالمراجعة الفنية والتحقق الطبي")}</label>}
      <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Validation Policy", "إنشاء سياسة التحقق")}</button>
    </form>

    <div className="table-wrap"><table>
      <thead><tr><th>{tr("Code", "الرمز")}</th><th>{tr("Scope", "النطاق")}</th><th>{tr("Path", "المسار")}</th><th>{tr("Reviewer separation", "فصل المراجعين")}</th><th>{tr("Effective", "السريان")}</th><th>{tr("Status", "الحالة")}</th><th></th></tr></thead>
      <tbody>{sortedPolicies.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No result validation policies configured. Default path is technical review only.", "لا توجد سياسات تحقق مهيأة. المسار الافتراضي هو المراجعة الفنية فقط.")}</td></tr> :
        sortedPolicies.map(policy => <tr key={policy.id}>
          <td><strong>{policy.code}</strong><br/><small>{locale === "ar" ? policy.nameAr || policy.nameEn : policy.nameEn}</small></td>
          <td>{scopeLabel(policy.scope)}{policy.department ? " · " + policy.department.code : policy.test ? " · " + policy.test.code : ""}</td>
          <td>{policy.requiresMedicalValidation ? tr("Technical → Medical", "فني ← طبي") : tr("Technical only", "فني فقط")}</td>
          <td>{policy.requiresMedicalValidation ? (policy.allowSameReviewer ? tr("Same user allowed", "نفس المستخدم مسموح") : tr("Different users required", "يلزم مستخدمان مختلفان")) : "—"}</td>
          <td>{policy.effectiveFrom + " → " + (policy.effectiveTo || tr("Open", "مفتوح"))}</td>
          <td>{policy.status === "ACTIVE" ? tr("Active", "نشط") : tr("Inactive", "غير نشط")}</td>
          <td><button type="button" className="secondary-button" disabled={saving} onClick={() => void setStatus(policy.id, policy.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>{policy.status === "ACTIVE" ? tr("Deactivate", "تعطيل") : tr("Reactivate", "إعادة تفعيل")}</button></td>
        </tr>)}
      </tbody>
    </table></div>
    {message && <p className="form-success">{message}</p>}
  </section>;
}
