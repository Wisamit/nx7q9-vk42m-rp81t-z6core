"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReferenceIntervalGovernanceActions({
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
        "Approve this reference interval for clinical use? It may supersede an earlier approved interval with the exact same context.",
        "اعتماد هذا المجال المرجعي للاستخدام السريري؟ قد يحل محل مجال معتمد سابق بنفس السياق تماماً.",
      ))) return;
    } else {
      const entered = prompt(tr(
        "Retirement reason (required):",
        "سبب إيقاف المجال المرجعي (مطلوب):",
      ));
      if (entered === null) return;
      reason = entered.trim();
      if (!reason) {
        setMessage(tr("Retirement reason is required.", "سبب إيقاف المجال المرجعي مطلوب."));
        return;
      }
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/catalog/reference-intervals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (response.ok) {
      router.refresh();
    } else if (body.error === "approved_reference_interval_overlap") {
      setMessage(tr(
        "Approval blocked: another approved interval with the same clinical context overlaps this effective period.",
        "تعذر الاعتماد: يوجد مجال مرجعي معتمد آخر بنفس السياق السريري ويتداخل مع فترة السريان.",
      ));
    } else {
      setMessage(body.error || tr("Could not update reference interval.", "تعذر تحديث المجال المرجعي."));
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
