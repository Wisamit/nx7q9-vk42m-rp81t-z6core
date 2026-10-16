"use client";

import { FormEvent, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { useRouter } from "next/navigation";

export function AnalyzerMappingGovernanceButton({
  analyzerId,
  id,
  approvalStatus,
  canApprove,
  authorId,
  actorId,
  locale,
}: {
  analyzerId: string;
  id: string;
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  canApprove: boolean;
  authorId: string | null;
  actorId: string;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const independent = !!authorId && authorId !== actorId;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "RETIRE" | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  function openReview(action: "APPROVE" | "RETIRE") {
    if (busy || !canApprove) return;
    if (action === "APPROVE" && (approvalStatus !== "DRAFT" || !independent)) return;
    if (action === "RETIRE" && approvalStatus !== "APPROVED") return;
    setReviewReason("");
    setMessage("");
    setReviewAction(action);
  }

  async function act(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = reviewAction;
    if (!action || busy || !canApprove) return;
    if (action === "APPROVE" && (approvalStatus !== "DRAFT" || !independent)) return;
    if (action === "RETIRE" && approvalStatus !== "APPROVED") return;
    const reason = action === "RETIRE" ? reviewReason.trim() : "";
    if (action === "RETIRE" && !reason) {
      setMessage(tr("Retirement reason is required.", "سبب الإيقاف مطلوب."));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/analyzers/${analyzerId}/mappings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
      const friendly = body.error === "analyzer_mapping_self_approval_forbidden"
        ? tr("The draft author cannot approve their own clinical analyzer mapping.", "لا يستطيع منشئ مسودة ربط الجهاز اعتمادها للاستخدام السريري بنفسه.")
        : body.error === "analyzer_mapping_creator_unknown"
          ? tr("Clinical approval requires traceable draft authorship. This legacy draft needs governed reconciliation.", "يتطلب الاعتماد السريري معرفة منشئ المسودة؛ هذه المسودة القديمة بحاجة إلى تسوية موثقة.")
          : body.error === "analyzer_mapping_live_permission_revoked"
            ? tr("Your approval permission or branch access is no longer active.", "صلاحية الاعتماد أو الوصول إلى الفرع لم تعد فعالة.")
            : body.error === "approved_analyzer_mapping_overlap"
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
        return;
      }
      setReviewAction(null);
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Verify mapping status before retrying.",
        "انقطع الاتصال. تحقق من حالة الربط قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  return <div>
    {canApprove && independent && approvalStatus === "DRAFT" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => openReview("APPROVE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Approve", "اعتماد")}</button> : null}
    {canApprove && approvalStatus === "DRAFT" && !independent ? <small>{authorId
      ? tr("Independent reviewer required.", "يجب أن يعتمد الربط شخص آخر.")
      : tr("Unverified draft author — governed review required.", "منشئ المسودة غير معروف — يلزم تدقيق موثق.")}</small> : null}
    {canApprove && approvalStatus === "APPROVED" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => openReview("RETIRE")}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Retire", "إيقاف")}</button> : null}
    <CrudModal open={reviewAction !== null} onClose={() => { if (!busy) setReviewAction(null); }}
      size="compact"
      title={reviewAction === "APPROVE"
        ? tr("Independent Analyzer Mapping Approval", "اعتماد مستقل لربط جهاز التحليل")
        : tr("Retire Analyzer Mapping", "إيقاف ربط جهاز التحليل")}
      description={tr(
        "This clinical mapping does not perform unit conversion. Review exact analyzer/LIS unit identity and the performing branch before any approval.",
        "لا يجري هذا الربط تحويل الوحدات. راجع تطابق وحدات الجهاز وLIS والفرع المنفذ قبل الاعتماد.",
      )}>
      {reviewAction && <form className="catalog-form" onSubmit={event => void act(event)}>
        <p className="form-span">{reviewAction === "APPROVE"
          ? tr("The independent reviewer must verify this exact mapped code, target unit and effective scope.",
            "يجب أن يتحقق المراجع المستقل من رمز الربط ووحدة الهدف ونطاق السريان بدقة.")
          : tr("Retirement only affects future analyzer imports. Already imported clinical results remain unchanged.",
            "يؤثر إيقاف الربط على الاستيراد المستقبلي فقط؛ تبقى النتائج المستوردة سابقاً دون تغيير.")}</p>
        {reviewAction === "RETIRE" && <label className="form-span">
          {tr("Retirement reason (required)", "سبب الإيقاف (مطلوب)")}
          <textarea value={reviewReason} required rows={3} maxLength={1000}
            onChange={event => setReviewReason(event.target.value)} />
        </label>}
        {message && <p role="alert" className="form-error form-span">{message}</p>}
        <button className="primary-button form-span" type="submit"
          disabled={busy || (reviewAction === "RETIRE" && !reviewReason.trim())}>
          {busy ? tr("Saving…", "جارٍ الحفظ…")
            : reviewAction === "APPROVE" ? tr("Confirm clinical mapping approval", "تأكيد اعتماد الربط السريري")
              : tr("Confirm retirement", "تأكيد الإيقاف")}
        </button>
      </form>}
    </CrudModal>
    {message && !reviewAction ? <p role="alert" className="form-warning">{message}</p> : null}
  </div>;
}
