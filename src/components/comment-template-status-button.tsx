"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function CommentTemplateStatusButton({
  id, status, fingerprint, canManage, canApprove, locale,
}: {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  fingerprint: string;
  canManage: boolean;
  canApprove: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const nextStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  async function changeStatus() {
    if (pending.current) return;
    if (nextStatus === "ACTIVE" && !canApprove) return;
    if (nextStatus === "INACTIVE" && !canManage) return;
    const question = nextStatus === "ACTIVE"
      ? tr(
        "Review the complete English AND Arabic text and linked test/component displayed above. Approve EXACT text for future clinical use? The creator/importer cannot approve their own template.",
        "راجع النص الكامل بالإنجليزية والعربية وربط الفحص والمكوّن المعروضين. هل تعتمد النص ذاته للاستخدام السريري اللاحق؟ لا يجوز للمُنشئ أو المستورد اعتماد قالب أنشأه.",
      )
      : tr(
        "Deactivate this template for future use? Released reports and recorded results will remain unchanged.",
        "هل تريد تعطيل استخدام القالب مستقبلًا؟ ستبقى التقارير الصادرة والنتائج المسجّلة دون تعديل.",
      );
    if (!confirm(question)) return;
    const supplied = prompt(tr(
      nextStatus === "ACTIVE"
        ? "Clinical review justification (10–1000 characters, required):"
        : "Deactivation reason (10–1000 characters, required):",
      nextStatus === "ACTIVE"
        ? "سبب الاعتماد بعد المراجعة السريرية (من 10 إلى 1000 حرف، إلزامي):"
        : "سبب التعطيل (من 10 إلى 1000 حرف، إلزامي):",
    ));
    if (supplied === null) return;
    const reason = supplied.trim();
    if (reason.length < 10 || reason.length > 1000) {
      setError(tr("A meaningful 10–1000 character reason is required.", "يجب إدخال سبب واضح من 10 إلى 1000 حرف."));
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
            confirmation: "APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT",
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
        };
        setError(errors[result.error || ""]?.[locale === "ar" ? 1 : 0] ||
          result.error || tr("Could not update template.", "تعذر تحديث القالب."));
        return;
      }
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
      onClick={() => void changeStatus()}>
      {busy ? tr("Saving…", "جارٍ الحفظ…") :
        nextStatus === "INACTIVE" ? tr("Deactivate", "تعطيل") :
        tr("Review & approve", "مراجعة واعتماد")}
    </button>
    {error && <p role="alert" className="form-warning">{error}</p>}
  </div>;
}
