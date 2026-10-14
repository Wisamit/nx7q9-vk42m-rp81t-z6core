"use client";

import { useState } from "react";
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
  const resourceKey = clinicalRuleProofResource(ruleType,id) || "";
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const lifecycle = status === "ACTIVE" ? "APPROVED" : deactivatedAt ? "RETIRED" : "DRAFT";

  function act(action: "APPROVE" | "RETIRE") {
    if (!branchId || !resourceKey) {
      setMessage(tr("An authorized active branch is required.","يلزم اختيار فرع نشط ومصرح به."));
      return;
    }
    let reason = "";
    if (action === "APPROVE") {
      if (!confirm(tr(
        "Approve this clinical rule for live result processing? Reauthentication is required.",
        "هل تعتمد هذه القاعدة لتعمل على النتائج الفعلية؟ يلزم تأكيد هويتك من جديد.",
      ))) return;
    } else {
      const entered = prompt(tr(
        "Retirement reason (required). Historical results remain unchanged:",
        "سبب إيقاف القاعدة (مطلوب). لن تتغير النتائج التاريخية:",
      ));
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) {
        setMessage(tr("Retirement reason is required.", "سبب الإيقاف مطلوب."));
        return;
      }
    }
    setMessage("");
    setPending({action,reason});
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
        const friendly = body.error === "clinical_rule_effective_range_overlap"
          ? tr("Approval blocked: an active rule with this identity overlaps the proposed period.",
            "تعذر الاعتماد: يوجد تداخل زمني مع قاعدة معتمدة بنفس الهوية.")
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
    <StaffStepUpDialog open={pending!==null}
      action={pending?.action==="RETIRE"?"CLINICAL_RULE_RETIRE":"CLINICAL_RULE_APPROVE"}
      resourceKey={resourceKey} branchId={branchId} locale={locale}
      onCancel={()=>setPending(null)}
      onGranted={token=>{if(pending)void submitWithProof(token,pending.action,pending.reason);}}/>
    {message ? <><br/><small role="alert">{message}</small></> : null}
  </div>;
}
