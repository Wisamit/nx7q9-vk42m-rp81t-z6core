"use client";
import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClinicalRuleGovernanceButton } from "@/components/clinical-rule-governance-button";
import { CrudModal } from "@/components/crud-modal";

type Scope = "ORGANIZATION" | "DEPARTMENT" | "TEST";
type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Policy = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  scope: Scope;
  branchId: string | null;
  departmentId: string | null;
  testId: string | null;
  requiresMedicalValidation: boolean;
  allowSameReviewer: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  deactivatedAt: string | null;
  branch?: Option | null;
  department?: Option | null;
  test?: Option | null;
};

export function ResultValidationPolicyManager({
  locale,
  branches,
  departments,
  tests,
  policies,
  canApprove,
  activeBranchId,
}: {
  locale: "ar" | "en";
  branches: Option[];
  departments: Option[];
  tests: Option[];
  policies: Policy[];
  canApprove: boolean;
  activeBranchId: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("ORGANIZATION");
  const [requiresMedicalValidation, setRequiresMedicalValidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const name = (x: Option) => locale === "ar" ? x.nameAr || x.nameEn : x.nameEn;
  const sortedPolicies = useMemo(
    () => [...policies].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [policies],
  );

  async function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      scope,
      branchId: form.get("branchId") || null,
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
    try {
      const response = await fetch("/api/clinical-rules/validation-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not create validation policy.", "تعذر إنشاء سياسة التحقق."));
        return;
      }
      setOpen(false);
      setScope("ORGANIZATION");
      setRequiresMedicalValidation(false);
      setMessage(tr("Validation policy draft created. It will not affect result validation until approved.", "تم إنشاء مسودة سياسة التحقق. لن تؤثر على مسار التحقق من النتائج قبل اعتمادها."));
      router.refresh();
    } catch {
      setFormError(tr("Connection error; draft creation not confirmed.", "خطأ في الاتصال؛ لم يتم تأكيد إنشاء المسودة."));
    } finally {
      setSaving(false);
    }
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
          "Technical review is always required. New validation paths are inactive drafts until separately approved. Medical validation can be required by organization, department, or test policy, with optional branch overrides.",
          "المراجعة الفنية مطلوبة دائماً. تُنشأ مسارات التحقق الجديدة كمسودات غير نشطة حتى يتم اعتمادها بشكل منفصل. ويمكن اشتراط التحقق الطبي على مستوى المؤسسة أو القسم أو الفحص مع تجاوزات حسب الفرع.",
        )}</p>
      </div>
      <button type="button" className="primary-button" disabled={saving}
        onClick={() => { setFormError(""); setMessage(""); setOpen(true); }}>
        {tr("Create Validation Policy Draft", "إنشاء مسودة سياسة تحقق")}
      </button>
    </div>

    <CrudModal open={open} onClose={() => { if (!saving) setOpen(false); }}
      size="compact"
      title={tr("Create Validation Policy Draft", "إنشاء مسودة سياسة التحقق")}
      description={tr(
        "This policy cannot change result validation until a separately authorized clinical review approves the draft.",
        "لا تغيّر هذه السياسة مسار التحقق من النتائج حتى تعتمدها مراجعة سريرية مخوّلة ومنفصلة.",
      )}>
      {open && <form className="catalog-form" onSubmit={createPolicy}>
      <label>{tr("Scope", "النطاق")}<select value={scope} onChange={e => setScope(e.target.value as Scope)}>
        <option value="ORGANIZATION">{scopeLabel("ORGANIZATION")}</option>
        <option value="DEPARTMENT">{scopeLabel("DEPARTMENT")}</option>
        <option value="TEST">{scopeLabel("TEST")}</option>
      </select></label>
      <label>{tr("Branch override", "تجاوز حسب الفرع")}<select name="branchId" defaultValue="">
        <option value="">{tr("All branches / organization default", "كل الفروع / افتراضي المؤسسة")}</option>
        {branches.map(x => <option key={x.id} value={x.id}>{x.code} — {name(x)}</option>)}
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
      <label>{tr("Effective from", "ساري من")}<SystemDateField name="effectiveFrom" required /></label>
      <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
      <label className="check-line"><input type="checkbox" checked={requiresMedicalValidation} onChange={e => setRequiresMedicalValidation(e.target.checked)} /> {tr("Require medical validation", "يتطلب تحققاً طبياً")}</label>
      {requiresMedicalValidation && <label className="check-line"><input type="checkbox" name="allowSameReviewer" /> {tr("Allow same user for technical and medical stages", "السماح لنفس المستخدم بالمراجعة الفنية والتحقق الطبي")}</label>}
      <button className="primary-button form-span" disabled={saving}>{saving ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Validation Policy Draft", "إنشاء مسودة سياسة التحقق")}</button>
      {formError && <p className="form-error form-span" role="alert">{formError}</p>}
    </form>}
    </CrudModal>

    <div className="table-wrap"><table>
      <thead><tr><th>{tr("Code", "الرمز")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Scope", "النطاق")}</th><th>{tr("Path", "المسار")}</th><th>{tr("Reviewer separation", "فصل المراجعين")}</th><th>{tr("Effective", "السريان")}</th><th>{tr("Governance", "الحوكمة")}</th></tr></thead>
      <tbody>{sortedPolicies.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No result validation policies configured. Default path is technical review only.", "لا توجد سياسات تحقق مهيأة. المسار الافتراضي هو المراجعة الفنية فقط.")}</td></tr> :
        sortedPolicies.map(policy => <tr key={policy.id}>
          <td><strong>{policy.code}</strong><br/><small>{locale === "ar" ? policy.nameAr || policy.nameEn : policy.nameEn}</small></td>
          <td>{policy.branch ? policy.branch.code + " — " + name(policy.branch) : tr("All branches", "كل الفروع")}</td>
          <td>{scopeLabel(policy.scope)}{policy.department ? " · " + policy.department.code : policy.test ? " · " + policy.test.code : ""}</td>
          <td>{policy.requiresMedicalValidation ? tr("Technical → Medical", "فني ← طبي") : tr("Technical only", "فني فقط")}</td>
          <td>{policy.requiresMedicalValidation ? (policy.allowSameReviewer ? tr("Same user allowed", "نفس المستخدم مسموح") : tr("Different users required", "يلزم مستخدمان مختلفان")) : "—"}</td>
          <td>{policy.effectiveFrom + " → " + (policy.effectiveTo || tr("Open", "مفتوح"))}</td>
          <td><ClinicalRuleGovernanceButton branchId={activeBranchId} id={policy.id} ruleType="RESULT_VALIDATION_POLICY" status={policy.status} deactivatedAt={policy.deactivatedAt} canApprove={canApprove} locale={locale} /></td>
        </tr>)}
      </tbody>
    </table></div>
    {message && <p className="form-success">{message}</p>}
  </section>;
}
