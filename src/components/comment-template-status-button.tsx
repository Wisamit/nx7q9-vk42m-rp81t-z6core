"use client";

import { FormEvent, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { useRouter } from "next/navigation";

export function CommentTemplateStatusButton({
  id, status, fingerprint, canManage, canApprove, locale, supersedesTemplateId = null,
}: {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  fingerprint: string;
  canManage: boolean;
  canApprove: boolean;
  locale: "ar" | "en";
  supersedesTemplateId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const pending = useRef(false);
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const nextStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  const question = nextStatus === "ACTIVE"
      ? supersedesTemplateId
        ? tr("Approve this exact revision and ATOMICALLY RETIRE the preceding approved template for future use? Released reports remain unchanged. Independent clinical approval is required.",
          "هل تعتمد هذه النسخة المحددة وتوقف القالب المعتمد السابق ضمن العملية نفسها للاستخدام المستقبلي؟ التقارير الصادرة لا تتغير ويجب الاعتماد من مراجع سريري مستقل.")
        : tr(
          "Review the complete English AND Arabic text and linked test/component displayed above. Approve EXACT text for future clinical use? The creator/importer cannot approve their own template.",
          "راجع النص الكامل بالإنجليزية والعربية وربط الفحص والمكوّن المعروضين. هل تعتمد النص ذاته للاستخدام السريري اللاحق؟ لا يجوز للمُنشئ أو المستورد اعتماد قالب أنشأه.",
        )
      : tr(
        "Deactivate this template for future use? Released reports and recorded results will remain unchanged.",
        "هل تريد تعطيل استخدام القالب مستقبلًا؟ ستبقى التقارير الصادرة والنتائج المسجّلة دون تعديل.",
      );

  function openReview() {
    if (pending.current) return;
    if (nextStatus === "ACTIVE" && !canApprove) return;
    if (nextStatus === "INACTIVE" && !canManage) return;
    setReviewReason("");
    setError("");
    setReviewOpen(true);
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (nextStatus === "ACTIVE" && !canApprove) return;
    if (nextStatus === "INACTIVE" && !canManage) return;
    const reason = reviewReason.trim();
    if (reason.length < 10 || reason.length > 1000) {
      setError(tr("A meaningful 10–1000 character reason is required.",
        "يجب إدخال سبب واضح من 10 إلى 1000 حرف."));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/clinical-rules/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, status: nextStatus, reason, expectedFingerprint: fingerprint,
          ...(nextStatus === "ACTIVE" ? {
            confirmation: supersedesTemplateId
              ? "APPROVE_REVISION_AND_RETIRE_PREDECESSOR"
              : "APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT",
          } : {}),
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const errors: Record<string, [string, string]> = {
          clinical_approval_permission_required: ["Clinical approval permission required.", "صلاحية الاعتماد السريري مطلوبة."],
          comment_template_review_stale: ["Template changed. Refresh and review again.", "تغير القالب. أعد تحميل الصفحة وراجع النص من جديد."],
          comment_template_self_approval_forbidden: ["A second, independent approver is required.", "يجب اعتماد القالب من مراجع آخر مستقل."],
          comment_template_origin_unverified: ["Creation evidence missing; authorization blocked.", "مصدر إنشاء القالب غير موثق؛ التفعيل محظور."],
          comment_template_target_inactive_or_invalid: ["Linked clinical target is inactive or invalid.", "الفحص أو المكوّن المرتبط غير فعال أو غير صالح."],
          comment_template_state_changed: ["Template status has changed. Refresh the page.", "تغيرت حالة القالب. أعد تحميل الصفحة."],
          comment_revision_predecessor_invalid_or_retired: ["The preceding approved revision is no longer active. Do not approve this draft.", "النسخة المعتمدة السابقة لم تعد فعالة. لا يمكن اعتماد المسودة."],
          comment_revision_predecessor_superseded: ["A newer revision exists. Old text cannot be reactivated.", "توجد نسخة أحدث؛ لا يمكن إعادة تفعيل النص القديم."],
        };
        setError(errors[result.error || ""]?.[locale === "ar" ? 1 : 0] ||
          result.error || tr("Could not update template.", "تعذر تحديث القالب."));
        return;
      }
      setReviewOpen(false);
      setReviewReason("");
      router.refresh();
    } catch {
      setError(tr("Connection failed. Verify status before retrying.", "فشل الاتصال. تحقق من الحالة قبل إعادة المحاولة."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (nextStatus === "ACTIVE" && !canApprove) {
    return <small>{tr("Clinical approver required", "يتطلب معتمدًا سريريًا")}</small>;
  }
  if (nextStatus === "INACTIVE" && !canManage) return null;
  return <div>
    <button type="button" className="secondary-button" disabled={busy}
      onClick={openReview}>
      {busy ? tr("Saving…", "جارٍ الحفظ…") :
        nextStatus === "INACTIVE" ? tr("Deactivate", "تعطيل") :
        tr("Review & approve", "مراجعة واعتماد")}
    </button>
    <CrudModal open={reviewOpen} onClose={() => { if (!busy) setReviewOpen(false); }}
      size="compact"
      title={nextStatus === "ACTIVE"
        ? tr("Independent Clinical Template Approval", "الاعتماد السريري المستقل للقالب")
        : tr("Retire Comment Template", "إيقاف قالب التعليق")}
      description={question}>
      {reviewOpen && <form className="catalog-form" onSubmit={event => void changeStatus(event)}>
        <p className="form-span">{nextStatus === "ACTIVE"
          ? tr("Review the EXACT bilingual template above and confirm clinical suitability. The creator cannot self-approve.",
            "راجع النص ثنائي اللغة كما هو معروض وتأكد من صلاحيته السريرية. لا يحق للمُنشئ اعتماد قالب أنشأه.")
          : tr("Deactivation affects future use only; released results and reports are immutable.",
            "يؤثر الإيقاف على الاستخدام المستقبلي فقط؛ تبقى النتائج والتقارير الصادرة ثابتة.")}</p>
        <label className="form-span">
          {nextStatus === "ACTIVE"
            ? tr("Clinical approval justification (10–1000 characters)", "سبب الاعتماد السريري (10–1000 محرف)")
            : tr("Deactivation reason (10–1000 characters)", "سبب التعطيل (10–1000 محرف)")}
          <textarea value={reviewReason} required minLength={10} maxLength={1000}
            rows={4} onChange={event => setReviewReason(event.target.value)} />
        </label>
        {error && <p role="alert" className="form-error form-span">{error}</p>}
        <button className="primary-button form-span" type="submit"
          disabled={busy || reviewReason.trim().length < 10}>
          {busy ? tr("Saving…", "جارٍ الحفظ…")
            : nextStatus === "ACTIVE" ? tr("Confirm exact clinical approval", "تأكيد الاعتماد السريري الدقيق")
              : tr("Confirm deactivation", "تأكيد التعطيل")}
        </button>
      </form>}
    </CrudModal>
    {error && !reviewOpen && <p role="alert" className="form-warning">{error}</p>}
  </div>;
}
