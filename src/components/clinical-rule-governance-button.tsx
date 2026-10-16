"use client";

import { type FormEvent, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { useRouter } from "next/navigation";
import { StaffStepUpDialog } from "@/components/staff-step-up-dialog";
import { clinicalRuleProofResource } from "@/lib/clinical-rule-step-up";

type RuleType =
  | "CALCULATED_RESULT_RULE"
  | "REFLEX_RULE"
  | "DELTA_RULE"
  | "AUTOVERIFICATION_POLICY"
  | "VALIDATION_HOLD_RULE"
  | "CRITICAL_ESCALATION_POLICY"
  | "RESULT_VALIDATION_POLICY";

export function ClinicalRuleGovernanceButton({
  id,
  ruleType,
  status,
  deactivatedAt,
  canApprove,
  locale,
  branchId,
}: {
  id: string;
  ruleType: RuleType;
  status: "ACTIVE" | "INACTIVE";
  deactivatedAt: string | null;
  canApprove: boolean;
  locale: "ar" | "en";
  branchId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{action:"APPROVE"|"RETIRE"; reason:string}|null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE"|"RETIRE"|null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const resourceKey = clinicalRuleProofResource(ruleType,id) || "";
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const lifecycle = status === "ACTIVE" ? "APPROVED" : deactivatedAt ? "RETIRED" : "DRAFT";

  function act(action: "APPROVE" | "RETIRE") {
    if (busy || pending || !canApprove) return;
    if (!branchId || !resourceKey) {
      setMessage(tr("An authorized active branch is required.", "يلزم اختيار فرع نشط ومصرح به."));
      return;
    }
    if ((action === "APPROVE" && lifecycle !== "DRAFT") ||
        (action === "RETIRE" && lifecycle !== "APPROVED")) {
      setMessage(tr("Rule state has changed. Refresh before reviewing.", "تغيّرت حالة القاعدة؛ حدّث الصفحة قبل المراجعة."));
      return;
    }
    setMessage("");
    setReviewReason("");
    setReviewAction(action);
  }

  function confirmReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !reviewAction || !canApprove || !branchId || !resourceKey) return;
    if ((reviewAction === "APPROVE" && lifecycle !== "DRAFT") ||
        (reviewAction === "RETIRE" && lifecycle !== "APPROVED")) return;
    const reason = reviewReason.trim();
    if (reviewAction === "RETIRE" && (reason.length < 10 || reason.length > 1000)) {
      setMessage(tr("A detailed retirement reason (10–1000 characters) is required.",
        "سبب إيقاف مفصّل (10–1000 محرف) مطلوب."));
      return;
    }
    // A separate, action-bound staff reauthentication is still mandatory.
    setPending({action:reviewAction,reason});
    setReviewAction(null);
    setMessage("");
  }

  async function submitWithProof(token: string, action: "APPROVE" | "RETIRE", reason: string) {
    // The one-time token is used immediately. It is never saved to browser storage.
    setPending(null);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/clinical-rules/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-step-up-token": token },
        cache:"no-store",
        body: JSON.stringify({ id, ruleType, action, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const friendly = body.error === "clinical_rule_organization_wide_branch_coverage_required"
          ? tr("Organization-wide rules require approval access to every active branch. Request appropriate organization-level access.",
            "اعتماد قاعدة على مستوى المؤسسة يتطلب صلاحية اعتماد لجميع الفروع النشطة. اطلب صلاحية معتمدة على مستوى المؤسسة.")
          : body.error === "clinical_rule_organization_wide_department_coverage_required"
            ? tr("Organization-wide rules also require coverage of every active department when department access is restricted.",
              "اعتماد قاعدة على مستوى المؤسسة يتطلب تغطية جميع الأقسام النشطة إذا كانت صلاحيات الأقسام مقيّدة.")
          : body.error === "clinical_rule_branch_scope_mismatch" ||
            body.error === "clinical_rule_branch_scope_revoked"
            ? tr("The selected branch is not authorized for this clinical rule. Check the branch and access grants.",
              "الفرع المختار غير مصرح له بهذه القاعدة. تحقق من الفرع والصلاحيات.")
          : body.error === "clinical_rule_effective_range_overlap"
          ? tr("Approval blocked: an active rule with this identity overlaps the proposed period.",
            "تعذر الاعتماد: يوجد تداخل زمني مع قاعدة معتمدة بنفس الهوية.")
          : body.error?.startsWith("clinical_rule_") &&
            /inactive|forbidden|scope|mismatch|source|target|method|threshold|numeric|validation/.test(body.error)
            ? tr("Approval blocked: a referenced test, component, department, method, branch or configuration is no longer eligible. Review the draft and create a corrected version.",
              "تعذر الاعتماد: أحد الفحوص أو المكونات أو الأقسام أو الطرق أو الفروع أو إعدادات القاعدة لم يعد صالحاً. راجع المسودة وأنشئ نسخة مصححة.")
          : body.error === "clinical_rule_not_draft"
            ? tr("Only a draft can be approved.", "يمكن اعتماد المسودة فقط.")
            : body.error === "only_approved_clinical_rule_can_be_retired"
              ? tr("Only an approved rule may be retired.", "يمكن إيقاف القاعدة المعتمدة فقط.")
              : body.error === "fresh_staff_reauthentication_required"
                ? tr("Fresh verification is required. Please retry.", "يلزم تحقق جديد من الهوية. أعد المحاولة.")
                : body.error || tr("Clinical rule change rejected.", "تعذر تغيير القاعدة السريرية.");
        setMessage(friendly);
      } else {
        router.refresh();
      }
    } catch {
      setMessage(tr("Connection interrupted. Verify the rule status before retrying.",
        "انقطع الاتصال. تأكد من حالة القاعدة قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <strong>{lifecycle === "APPROVED" ? tr("Approved", "معتمد") : lifecycle === "RETIRED" ? tr("Retired", "موقوف") : tr("Draft", "مسودة")}</strong>
    {canApprove && lifecycle === "DRAFT" ? <><br/><button type="button" className="secondary-button" disabled={busy} onClick={() => void act("APPROVE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Approve", "اعتماد")}</button></> : null}
    {canApprove && lifecycle === "APPROVED" ? <><br/><button type="button" className="secondary-button" disabled={busy} onClick={() => void act("RETIRE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Retire", "إيقاف")}</button></> : null}
    <CrudModal open={reviewAction!==null}
      onClose={()=>{if(!busy)setReviewAction(null);}}
      size="compact"
      title={reviewAction==="APPROVE"
        ? tr("Approve Clinical Rule", "اعتماد قاعدة سريرية")
        : tr("Retire Clinical Rule", "إيقاف قاعدة سريرية")}
      description={tr(
        "Review this exact governed rule. Approval affects live clinical validation and requires fresh staff reauthentication; prior released results remain immutable.",
        "راجع القاعدة المحددة. يؤثر الاعتماد على التحقق من النتائج الفعلية ويتطلب تحققاً جديداً من الموظف؛ تبقى النتائج الصادرة السابقة ثابتة.",
      )}>
      {reviewAction&&<form className="catalog-form" onSubmit={confirmReview}>
        <p className="form-span"><strong>{ruleType.replaceAll("_"," ")}</strong></p>
        <p className="form-span">{reviewAction==="APPROVE"
          ? tr("Approve this draft for live clinical processing only after checking exact effective dates, branches, methods and limits.",
            "اعتمد هذه المسودة للاستخدام السريري فقط بعد مراجعة تواريخ السريان والفروع والطرق والحدود بدقة.")
          : tr("Retiring this approved rule does not rewrite previously released clinical history.",
            "إيقاف هذه القاعدة المعتمدة لا يغيّر التاريخ السريري الصادر سابقاً.")}</p>
        {reviewAction==="RETIRE"&&<label className="form-span">
          {tr("Documented retirement reason (required)", "سبب إيقاف القاعدة الموثق (إلزامي)")}
          <textarea rows={3} minLength={10} maxLength={1000} required
            value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/>
        </label>}
        {message&&<p role="alert" className="form-error form-span">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {tr("Continue to staff verification", "المتابعة إلى تحقق الموظف")}
        </button>
      </form>}
    </CrudModal>
    <StaffStepUpDialog open={pending!==null}
      action={pending?.action==="RETIRE"?"CLINICAL_RULE_RETIRE":"CLINICAL_RULE_APPROVE"}
      resourceKey={resourceKey} branchId={branchId} locale={locale}
      onCancel={()=>setPending(null)}
      onGranted={token=>{if(pending)void submitWithProof(token,pending.action,pending.reason);}}/>
    {message ? <><br/><small role="alert">{message}</small></> : null}
  </div>;
}
