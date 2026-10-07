"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzerMappingGovernanceButton({
  analyzerId,
  id,
  approvalStatus,
  canApprove,
  locale,
}: {
  analyzerId: string;
  id: string;
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  canApprove: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function act(action: "APPROVE" | "RETIRE") {
    let reason = "";
    if (action === "APPROVE") {
      if (!confirm(tr(
        "Approve this analyzer mapping for clinical use? No unit conversion is performed: the analyzer unit code must already represent the displayed LIS target unit.",
        "اعتماد ربط جهاز التحليل للاستخدام السريري؟ لا يتم تحويل الوحدات: يجب أن يمثل رمز وحدة الجهاز وحدة LIS الهدف المعروضة فعلياً.",
      ))) return;
    } else {
      const entered = prompt(tr(
        "Retirement reason (required). Previously imported clinical results remain unchanged:",
        "سبب إيقاف الربط (مطلوب). ستبقى النتائج السريرية المستوردة سابقاً دون تغيير:",
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
    const response = await fetch(`/api/analyzers/${analyzerId}/mappings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      const friendly = body.error === "approved_analyzer_mapping_overlap"
        ? tr("Approval blocked because another approved mapping for the same analyzer code overlaps this effective period.", "تعذر الاعتماد لأن ربطاً معتمداً آخر لنفس رمز الجهاز يتداخل مع فترة السريان.")
        : body.error === "analyzer_unit_code_required_for_unit_target"
          ? tr("Approval blocked: this LIS target has a unit, so the exact analyzer unit code is required.", "تعذر الاعتماد: هدف LIS له وحدة، لذلك يجب تحديد رمز وحدة الجهاز بدقة.")
          : body.error === "analyzer_unit_requires_lis_target_unit"
            ? tr("Approval blocked: the analyzer unit cannot be accepted while the LIS target is configured as unitless.", "تعذر الاعتماد: لا يمكن قبول وحدة من الجهاز بينما هدف LIS مهيأ بدون وحدة.")
            : body.error === "analyzer_mapping_not_draft"
              ? tr("Only a draft mapping can be approved.", "يمكن اعتماد الربط عندما يكون مسودة فقط.")
              : body.error === "only_approved_analyzer_mapping_can_be_retired"
                ? tr("Only an approved mapping can be retired.", "يمكن إيقاف الربط المعتمد فقط.")
                : body.error || tr("Could not update analyzer mapping governance.", "تعذر تحديث حوكمة ربط جهاز التحليل.");
      setMessage(friendly);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return <div>
    {canApprove && approvalStatus === "DRAFT" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("APPROVE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Approve", "اعتماد")}</button> : null}
    {canApprove && approvalStatus === "APPROVED" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("RETIRE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Retire", "إيقاف")}</button> : null}
    {message ? <><br/><small>{message}</small></> : null}
  </div>;
}
