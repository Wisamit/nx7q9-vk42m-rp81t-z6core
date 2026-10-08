"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TatPolicyGovernanceActions({
  id,
  approvalStatus,
  locale,
}: {
  id: string;
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
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
        "Approve this TAT / SLA policy for operational use? It may close an earlier approved policy with the exact same scope.",
        "اعتماد سياسة TAT / SLA للاستخدام التشغيلي؟ قد تغلق سياسة معتمدة سابقة بنفس النطاق تماماً.",
      ))) return;
    } else {
      const entered = prompt(tr("Retirement reason (required):", "سبب إيقاف السياسة (مطلوب):"));
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) {
        setMessage(tr("Retirement reason is required.", "سبب إيقاف السياسة مطلوب."));
        return;
      }
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/catalog/tat-policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (response.ok) {
      router.refresh();
    } else if (body.error === "approved_tat_policy_overlap") {
      setMessage(tr(
        "Approval blocked: another approved policy with the same branch / priority scope overlaps this effective period.",
        "تعذر الاعتماد: توجد سياسة معتمدة أخرى بنفس نطاق الفرع / الأولوية وتتداخل مع فترة السريان.",
      ));
    } else {
      setMessage(body.error || tr("Could not update TAT / SLA policy.", "تعذر تحديث سياسة TAT / SLA."));
    }
    setBusy(false);
  }

  if (approvalStatus === "RETIRED") return null;

  return <div>
    {approvalStatus === "DRAFT" && <button type="button" className="primary-button" disabled={busy} onClick={() => void act("APPROVE")}>
      {busy ? tr("Approving…", "جارٍ الاعتماد…") : tr("Approve", "اعتماد")}
    </button>}
    {approvalStatus === "APPROVED" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("RETIRE")}>
      {busy ? tr("Retiring…", "جارٍ الإيقاف…") : tr("Retire", "إيقاف")}
    </button>}
    {message && <p className="form-error">{message}</p>}
  </div>;
}
