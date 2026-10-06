"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function MicrobiologyFinalWorkflow({
  caseId,
  resultId,
  resultStatus,
  finalComment,
  canEnter,
  canVerify,
  canRelease,
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
  orderId: string;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function submitFinal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("submit");
    setMessage("");

    const response = await fetch(`/api/microbiology/cases/${caseId}/submit-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalComment: form.get("finalComment") }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage(tr("Final microbiology content submitted for verification.", "تم إرسال المحتوى النهائي للأحياء الدقيقة للتحقق."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not submit final microbiology result.", "تعذر إرسال نتيجة الأحياء الدقيقة النهائية."));
    }
  }


  async function withdraw() {
    if (!resultId) return;
    if (!confirm(tr("Withdraw this unverified final submission for correction? The submitted result version will be preserved as CANCELLED.", "سحب الإرسال النهائي غير المتحقق منه للتصحيح؟ سيبقى إصدار النتيجة المرسل محفوظًا بحالة ملغى."))) return;

    setBusy("withdraw");
    setMessage("");
    const response = await fetch(`/api/microbiology/cases/${caseId}/withdraw-final`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage(tr("Final submission withdrawn. Culture data is editable again; resubmission will create a new result version.", "تم سحب الإرسال النهائي. أصبحت بيانات الزرع قابلة للتعديل مجددًا، وسيؤدي الإرسال الجديد إلى إنشاء إصدار نتيجة جديد."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not withdraw microbiology submission.", "تعذر سحب إرسال الأحياء الدقيقة."));
    }
  }

  async function verify() {
    if (!resultId) return;
    if (!confirm(tr("Verify this microbiology result? Later changes must use an amendment workflow.", "التحقق من نتيجة الأحياء الدقيقة؟ أي تغيير لاحق يجب أن يتم عبر مسار التعديل."))) return;

    setBusy("verify");
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmDeltaWarnings: false }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage(tr("Microbiology result verified.", "تم التحقق من نتيجة الأحياء الدقيقة."));
      router.refresh();
    } else if (body.error === "validation_hold_review_required") {
      setMessage(tr("Verification blocked: resolve active blocking validation holds first.", "التحقق محظور: يجب حل حجوزات التحقق المانعة أولًا."));
    } else if (body.error === "reflex_review_required") {
      setMessage(tr("Verification blocked: review pending reflex recommendations first.", "التحقق محظور: راجع توصيات الفحوصات الانعكاسية المعلقة أولًا."));
    } else {
      setMessage(body.error || tr("Microbiology verification failed.", "فشل التحقق من نتيجة الأحياء الدقيقة."));
    }
  }

  async function release() {
    if (!resultId) return;
    if (!confirm(tr("Release this verified microbiology result? This creates a new immutable diagnostic report version.", "إصدار نتيجة الأحياء الدقيقة المتحقق منها؟ سيؤدي ذلك إلى إنشاء إصدار تقرير تشخيصي جديد غير قابل للتغيير."))) return;

    setBusy("release");
    setMessage("");
    const response = await fetch(`/api/results/${resultId}/release`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setBusy("");

    if (response.ok) {
      setMessage(`${tr("Microbiology result released. Report version", "تم إصدار نتيجة الأحياء الدقيقة. تم إنشاء إصدار التقرير")} ${body.reportVersion}.`);
      router.refresh();
    } else {
      setMessage(body.error || tr("Microbiology release failed.", "فشل إصدار نتيجة الأحياء الدقيقة."));
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Final Microbiology Result", "نتيجة الأحياء الدقيقة النهائية")}</h2>
    <p className="muted">{tr("Submitting creates or updates a versioned LaboratoryResult. Verification and release remain separate controlled steps.", "يؤدي الإرسال إلى إنشاء أو تحديث LaboratoryResult ذي إصدار محفوظ، بينما يبقى التحقق والإصدار خطوتين مستقلتين ومضبوطتين.")}</p>

    {canEnter && (!resultStatus || ["DRAFT","ENTERED"].includes(resultStatus)) && <form className="catalog-form" onSubmit={submitFinal}>
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
      {resultId && resultStatus === "ENTERED" && canVerify &&
        <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void verify()}>
          {busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Microbiology Result", "التحقق من نتيجة الأحياء الدقيقة")}
        </button>}
      {resultId && resultStatus === "VERIFIED" && canRelease &&
        <button className="primary-button" type="button" disabled={busy !== ""} onClick={() => void release()}>
          {busy === "release" ? tr("Releasing…", "جارٍ الإصدار…") : tr("Release Microbiology Result", "إصدار نتيجة الأحياء الدقيقة")}
        </button>}
      {resultStatus === "RELEASED" &&
        <a className="secondary-link" href={`/reports/${orderId}`}>{tr("Open Diagnostic Report", "فتح التقرير التشخيصي")}</a>}
    </div>

    {message && <p className="form-success">{message}</p>}
  </section>;
}
