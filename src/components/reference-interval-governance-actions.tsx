"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "RETIRE" | null>(null);
  const [reason, setReason] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  function openReview(action: "APPROVE" | "RETIRE") {
    if (inFlight.current || busy || (action === "APPROVE" && approvalStatus !== "DRAFT") ||
        (action === "RETIRE" && approvalStatus !== "APPROVED")) return;
    setMessage("");
    setReason("");
    setReviewAction(action);
  }

  async function confirmReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = reviewAction;
    if (!action || inFlight.current || busy ||
        (action === "APPROVE" && approvalStatus !== "DRAFT") ||
        (action === "RETIRE" && approvalStatus !== "APPROVED")) return;
    const documentedReason = reason.trim();
    if (action === "RETIRE" && (!documentedReason || documentedReason.length > 1000)) {
      setMessage(tr("A retirement reason (up to 1000 characters) is required.",
        "سبب إيقاف المجال المرجعي مطلوب (حتى 1000 محرف)."));
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/reference-intervals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason: action === "RETIRE" ? documentedReason : "" }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        setReviewAction(null);
        router.refresh();
      } else if (body.error === "approved_reference_interval_overlap") {
        setMessage(tr(
          "Approval blocked: another approved interval with the same clinical context overlaps this effective period.",
          "تعذر الاعتماد: يوجد مجال مرجعي معتمد آخر بنفس السياق السريري ويتداخل مع فترة السريان.",
        ));
      } else {
        setMessage(body.error || tr("Could not update reference interval. Refresh its status before retrying.",
          "تعذر تحديث المجال المرجعي. تحقق من الحالة قبل إعادة المحاولة."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Verify the interval status before retrying.",
        "انقطع الاتصال. تحقق من حالة المجال المرجعي قبل إعادة المحاولة."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (approvalStatus === "RETIRED") return null;

  return <div>
    {approvalStatus === "DRAFT" && <button type="button" className="primary-button"
      disabled={busy} onClick={() => openReview("APPROVE")}>
      {busy ? tr("Approving…", "جارٍ الاعتماد…") : tr("Approve", "اعتماد")}
    </button>}
    {approvalStatus === "APPROVED" && <button type="button" className="secondary-button"
      disabled={busy} onClick={() => openReview("RETIRE")}>
      {busy ? tr("Retiring…", "جارٍ الإيقاف…") : tr("Retire", "إيقاف")}
    </button>}
    <CrudModal open={reviewAction !== null} onClose={() => { if (!inFlight.current) setReviewAction(null); }}
      size="compact"
      title={reviewAction === "APPROVE"
        ? tr("Approve Reference Interval", "اعتماد مجال مرجعي")
        : tr("Retire Reference Interval", "إيقاف مجال مرجعي")}
      description={tr(
        "Review the selected interval and its effective dates in the catalog before committing. Clinical approval can change future result interpretation; released reports retain historical snapshots.",
        "راجع المجال المرجعي المحدد وتواريخ سريانه في الكتالوج قبل التنفيذ. قد يؤثر الاعتماد على تفسير النتائج المستقبلية، وتبقى التقارير الصادرة محفوظة.",
      )}>
      {reviewAction && <form className="catalog-form" onSubmit={confirmReview}>
        <p className="form-span"><strong>{tr("Interval identifier", "معرّف المجال المرجعي")}:</strong> {id}</p>
        <p className="form-span">{reviewAction === "APPROVE"
          ? tr("Approve this DRAFT for clinical use? The server will recheck overlapping intervals and approval permission.",
            "اعتماد هذه المسودة للاستخدام السريري؟ سيتحقق الخادم مجدداً من المجالات المتداخلة وصلاحية الاعتماد.")
          : tr("Retire this APPROVED interval? Previously released results and reports remain unchanged.",
            "إيقاف هذا المجال المرجعي المعتمد؟ لن تتغير النتائج والتقارير الصادرة سابقاً.")}</p>
        {reviewAction === "RETIRE" && <label className="form-span">
          {tr("Documented retirement reason (required)", "سبب الإيقاف الموثق (مطلوب)")}
          <textarea required rows={3} maxLength={1000} value={reason}
            onChange={event => setReason(event.target.value)} />
        </label>}
        {message && <p role="alert" className="form-error form-span">{message}</p>}
        <div className="crud-modal-actions form-span">
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => setReviewAction(null)}>{tr("Cancel", "إلغاء")}</button>
          <button type="submit" className="primary-button" disabled={busy ||
            (reviewAction === "RETIRE" && !reason.trim())}>
            {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm action", "تأكيد الإجراء")}
          </button>
        </div>
      </form>}
    </CrudModal>
  </div>;
}
