"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation"
import { CrudModal } from "@/components/crud-modal";

export function MicrobiologyFinalWorkflow({
  caseId,
  resultId,
  resultStatus,
  finalComment,
  canEnter,
  canVerify,
  canRelease,
  specimenReadyForProcessing,
  orderId,
  locale,
}: {
  caseId: string;
  resultId: string | null;
  resultStatus: string | null;
  finalComment: string;
  canEnter: boolean;
  canVerify: boolean;
  canRelease: boolean;
  specimenReadyForProcessing: boolean;
  orderId: string;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<"WITHDRAW"|"VERIFY"|"RELEASE"|null>(null);

  async function submitFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("submit");
    setMessage("");

    try {
    const response = await fetch(`/api/microbiology/cases/${caseId}/submit-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalComment: form.get("finalComment") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setEditorOpen(false);
      setMessage(tr("Final microbiology content submitted for verification.", "تم إرسال المحتوى النهائي للأحياء الدقيقة للتحقق."));
      router.refresh();
    } else {
      const errors: Record<string, string> = {
        microbiology_result_changed_or_under_review: tr("This result was changed or reviewed by another operator. Refresh before any correction.", "تم تعديل هذه النتيجة أو مراجعتها بواسطة مستخدم آخر. حدّث البيانات قبل التصحيح."),
        microbiology_case_state_changed: tr("Culture content changed while submitting. Refresh and review all observations.", "تغيرت بيانات الزرع أثناء الإرسال. حدّث الصفحة وراجع الملاحظات."),
        microbiology_result_version_conflict: tr("Another result version was created. Refresh to prevent duplicate clinical history.", "تم إنشاء إصدار نتيجة آخر. حدّث الصفحة لمنع تكرار السجل السريري."),
        specimen_not_ready_for_microbiology: tr("The specimen is no longer available for microbiology processing.", "العينة لم تعد متاحة لمعالجة الأحياء الدقيقة."),
        no_growth_conflicts_with_isolates: tr("A no-growth result cannot contain recorded isolates.", "نتيجة عدم وجود نمو لا يمكن أن تتضمن عزلات مسجلة."),
      };
      setMessage(errors[body.error] || tr("Could not submit final microbiology result.", "تعذر إرسال نتيجة الأحياء الدقيقة النهائية."));
    }
    } catch {
      setMessage(tr("Connection interrupted. Check latest microbiology version before resubmitting.",
        "انقطع الاتصال؛ راجع آخر إصدار لنتيجة الأحياء الدقيقة قبل إعادة الإرسال."));
    } finally { setBusy(""); }
  }

  async function withdraw() {
    if (!resultId || busy || reviewAction !== "WITHDRAW") return;
    setBusy("withdraw");
    setMessage("");
    try {
      const response = await fetch("/api/microbiology/cases/" + caseId + "/withdraw-final", {method:"POST"});
      const body = await response.json().catch(() => ({})) as {error?: string};
      if (response.ok) {
        setReviewAction(null);
        setMessage(tr(
          "Final submission withdrawn. Culture data is editable again; resubmission will create a new result version.",
          "تم سحب الإرسال النهائي. أصبحت بيانات الزرع قابلة للتعديل مجددًا، وسيؤدي الإرسال الجديد إلى إنشاء إصدار نتيجة جديد.",
        ));
        router.refresh();
      } else {
        setMessage(body.error === "microbiology_result_changed_or_under_review"
          ? tr("The result has already been reviewed or changed; use the controlled review/return workflow.",
            "تمت مراجعة النتيجة أو تعديلها؛ استخدم مسار المراجعة أو الإرجاع المعتمد.")
          : tr("Could not withdraw microbiology submission. Refresh and try again.",
            "تعذر سحب إرسال الأحياء الدقيقة. حدّث الصفحة ثم أعد المحاولة."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Check result/version state before retrying.",
        "انقطع الاتصال؛ تحقق من حالة النتيجة وإصدارها قبل إعادة المحاولة."));
    } finally { setBusy(""); }
  }

  async function verify() {
    if (!resultId || busy || reviewAction !== "VERIFY") return;
    setBusy("verify");
    setMessage("");
    try {
      const response = await fetch("/api/results/" + resultId + "/verify", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({confirmDeltaWarnings:false}),
      });
      const body = await response.json().catch(() => ({})) as {error?: string};
      if (response.ok) {
        setReviewAction(null);
        setMessage(tr("Microbiology result verified.", "تم التحقق من نتيجة الأحياء الدقيقة."));
        router.refresh();
      } else if (body.error === "validation_hold_review_required") {
        setMessage(tr("Verification blocked: resolve active blocking validation holds first.",
          "التحقق محظور: يجب حل حجوزات التحقق المانعة أولًا."));
      } else if (body.error === "reflex_review_required") {
        setMessage(tr("Verification blocked: review pending reflex recommendations first.",
          "التحقق محظور: راجع توصيات الفحوصات الانعكاسية المعلقة أولًا."));
      } else {
        setMessage(body.error || tr("Microbiology verification failed.", "فشل التحقق من نتيجة الأحياء الدقيقة."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Check result/version state before retrying.",
        "انقطع الاتصال؛ تحقق من حالة النتيجة وإصدارها قبل إعادة المحاولة."));
    } finally {setBusy("");}
  }

  async function release() {
    if (!resultId || busy || reviewAction !== "RELEASE") return;
    setBusy("release");
    setMessage("");
    try {
      const response = await fetch("/api/results/" + resultId + "/release", {method:"POST"});
      const body = await response.json().catch(() => ({})) as {error?: string; reportVersion?: string};
      if (response.ok) {
        setReviewAction(null);
        setMessage(tr("Microbiology result released. Report version",
          "تم إصدار نتيجة الأحياء الدقيقة. تم إنشاء إصدار التقرير") + " " + (body.reportVersion || "—") + ".");
        router.refresh();
      } else {
        setMessage(body.error || tr("Microbiology release failed.", "فشل إصدار نتيجة الأحياء الدقيقة."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Check for a released report/version before retrying.",
        "انقطع الاتصال؛ تحقق من وجود تقرير وإصدار منشور قبل إعادة المحاولة."));
    } finally {setBusy("");}
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Final Microbiology Result", "نتيجة الأحياء الدقيقة النهائية")}</h2>
    <p className="muted">{tr("Submitting creates or updates a versioned LaboratoryResult. Verification and release remain separate controlled steps.", "يؤدي الإرسال إلى إنشاء أو تحديث LaboratoryResult ذي إصدار محفوظ، بينما يبقى التحقق والإصدار خطوتين مستقلتين ومضبوطتين.")}</p>

    {canEnter && specimenReadyForProcessing && (!resultStatus || ["DRAFT","ENTERED"].includes(resultStatus)) && <form className="catalog-form" onSubmit={submitFinal}>
      <label className="form-span">{tr("Final interpretive comment", "التعليق التفسيري النهائي")}
        <textarea name="finalComment" rows={4} required defaultValue={finalComment} />
      </label>
      <button className="primary-button form-span" disabled={busy !== ""}>
        {busy === "submit" ? tr("Submitting…", "جارٍ الإرسال…") : resultId ? tr("Update Final Submission", "تحديث الإرسال النهائي") : tr("Submit for Verification", "إرسال للتحقق")}
      </button>
    </form>}

    <div className="result-workflow-status">
      <div><span>{tr("Laboratory result", "نتيجة المختبر")}</span><strong>{resultStatus || tr("NOT SUBMITTED", "غير مرسلة")}</strong></div>
    </div>

    <div className="result-actions">
      {resultId && resultStatus === "ENTERED" && canEnter &&
        <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void withdraw()}>
          {busy === "withdraw" ? tr("Withdrawing…", "جارٍ السحب…") : tr("Withdraw for Correction", "سحب للتصحيح")}
        </button>}
      {resultId && resultStatus === "ENTERED" && canVerify && specimenReadyForProcessing &&
        <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>
          {busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Microbiology Result", "التحقق من نتيجة الأحياء الدقيقة")}
        </button>}
      {resultId && resultStatus === "VERIFIED" && canRelease && specimenReadyForProcessing &&
        <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => void release()}>
          {busy === "release" ? tr("Releasing…", "جارٍ الإصدار…") : tr("Release Microbiology Result", "إصدار نتيجة الأحياء الدقيقة")}
        </button>}
      {resultStatus === "RELEASED" &&
        <a className="secondary-link" href={`/reports/${orderId}`}>{tr("Open Diagnostic Report", "فتح التقرير التشخيصي")}</a>}
    </div>

    {message && <p className="form-success">{message}</p>}
  </section>;
}
