"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  id: string;
  ruleType: RuleType;
  status: "ACTIVE" | "INACTIVE";
  deactivatedAt: string | null;
  canApprove: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const lifecycle = status === "ACTIVE" ? "APPROVED" : deactivatedAt ? "RETIRED" : "DRAFT";

  async function act(action: "APPROVE" | "RETIRE") {
    let reason = "";
    if (action === "APPROVE") {
      if (!confirm(tr(
        "Approve this clinical rule for live result processing? Approval can change calculations, validation, alerts or release behavior according to the rule type.",
        "اعتماد هذه القاعدة السريرية لمعالجة النتائج الفعلية؟ قد يغيّر الاعتماد الحسابات أو التحقق أو التنبيهات أو سلوك إصدار النتائج بحسب نوع القاعدة.",
      ))) return;
    } else {
      const entered = prompt(tr(
        "Retirement reason (required). Historical result evidence will remain unchanged:",
        "سبب إيقاف القاعدة (مطلوب). ستبقى أدلة النتائج التاريخية دون تغيير:",
      ));
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) {
        setMessage(tr("Retirement reason is required.", "سبب الإيقاف مطلوب."));
        return;
      }
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/clinical-rules/governance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ruleType, action, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (!response.ok) {
      const friendly = body.error === "clinical_rule_effective_range_overlap"
        ? tr("Approval blocked because an approved rule with the same clinical identity overlaps this period.", "تعذر الاعتماد لأن قاعدة معتمدة بنفس الهوية السريرية تتداخل مع هذه الفترة.")
        : body.error === "calculated_formula_chaining_not_supported"
          ? tr("Approval blocked because the formula would depend on another calculated component.", "تعذر الاعتماد لأن المعادلة ستعتمد على مكوّن محسوب آخر.")
          : body.error === "clinical_rule_not_draft"
            ? tr("Only a draft rule can be approved.", "يمكن اعتماد القاعدة عندما تكون مسودة فقط.")
            : body.error === "only_approved_clinical_rule_can_be_retired"
              ? tr("Only an approved rule can be retired.", "يمكن إيقاف القاعدة المعتمدة فقط.")
              : body.error || tr("Could not update clinical rule governance.", "تعذر تحديث حوكمة القاعدة السريرية.");
      setMessage(friendly);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return <div>
    <strong>{lifecycle === "APPROVED" ? tr("Approved", "معتمد") : lifecycle === "RETIRED" ? tr("Retired", "موقوف") : tr("Draft", "مسودة")}</strong>
    {canApprove && lifecycle === "DRAFT" ? <><br/><button type="button" className="secondary-button" disabled={busy} onClick={() => void act("APPROVE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Approve", "اعتماد")}</button></> : null}
    {canApprove && lifecycle === "APPROVED" ? <><br/><button type="button" className="secondary-button" disabled={busy} onClick={() => void act("RETIRE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Retire", "إيقاف")}</button></> : null}
    {message ? <><br/><small>{message}</small></> : null}
  </div>;
}
