"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestContactChallenge, verifyContactChallenge } from "@/lib/portal-contact-verification-client";

type VerificationChannel = "EMAIL" | "SMS";

export function PortalContactVerification({
  email,
  phone,
  emailVerifiedAt,
  phoneVerifiedAt,
  locale,
}: {
  email: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [channel, setChannel] = useState<VerificationChannel>(email && !emailVerifiedAt ? "EMAIL" : "SMS");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const pending = useRef(false);

  const hasUnverifiedEmail = Boolean(email && !emailVerifiedAt);
  const hasUnverifiedPhone = Boolean(phone && !phoneVerifiedAt);
  const availableChannel: VerificationChannel =
    hasUnverifiedEmail && hasUnverifiedPhone ? channel :
      hasUnverifiedEmail ? "EMAIL" : "SMS";
  if (!hasUnverifiedEmail && !hasUnverifiedPhone) return null;

  async function requestCode() {
    if (pending.current || requiresReconciliation) return;
    pending.current = true;
    setBusy("request");
    setMessage("");
    try {
      const result = await requestContactChallenge(availableChannel);
      if (result.kind === "queued") {
        setChallengeId(result.challengeId);
        setDestination(result.destination);
        setCode("");
        setMessage(tr(
          "Verification code queued. If your organization uses manual notification dispatch, an administrator must dispatch the outbound queue.",
          "تمت إضافة رمز التحقق إلى قائمة الإرسال. إذا كانت المؤسسة تستخدم الإرسال اليدوي فيجب على المسؤول تشغيل قائمة الصادر.",
        ));
      } else if (result.kind === "rejected") {
        const errors: Record<string, string> = {
          rate_limited: tr("Too many verification requests. Try again later.", "عدد محاولات التحقق كبير. حاول لاحقًا."),
          portal_email_missing: tr("No email is configured for this portal account.", "لا يوجد بريد إلكتروني مهيأ لهذا الحساب."),
          portal_phone_missing: tr("No phone is configured for this portal account.", "لا يوجد رقم هاتف مهيأ لهذا الحساب."),
          portal_unauthorized: tr("Your session expired. Sign in again.", "انتهت الجلسة. سجّل الدخول من جديد."),
          password_change_required: tr("Change your password before verifying contact details.", "غيّر كلمة المرور قبل التحقق من بيانات الاتصال."),
        };
        setMessage(errors[result.error] || tr("Could not queue verification code.", "تعذر إضافة رمز التحقق إلى قائمة الإرسال."));
      } else {
        // A timeout or unreadable receipt may follow a committed challenge;
        // requesting again could invalidate a code already dispatched.
        setRequiresReconciliation(true);
        setMessage(tr(
          "Request status is unknown. Check your messages, then reload this page to reconcile before requesting another code.",
          "حالة طلب الرمز غير مؤكدة. تحقق من رسائلك ثم أعد تحميل الصفحة للتحقق من الحالة قبل طلب رمز آخر.",
        ));
      }
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || requiresReconciliation || !challengeId || code.trim().length !== 6) return;
    pending.current = true;
    setBusy("verify");
    setMessage("");
    try {
      const result = await verifyContactChallenge(challengeId, code);
      if (result.kind === "verified") {
        setMessage(tr("Contact verified.", "تم التحقق من جهة الاتصال."));
        setChallengeId("");
        setCode("");
        router.refresh();
      } else if (result.kind === "rejected") {
        const errors: Record<string, string> = {
          invalid_verification_code: tr("The verification code is invalid.", "رمز التحقق غير صحيح."),
          verification_code_expired: tr("The verification code expired. Request a new one.", "انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا."),
          verification_attempts_exceeded: tr("Too many incorrect attempts. Request a new code.", "عدد المحاولات الخاطئة كبير. اطلب رمزًا جديدًا."),
          verification_destination_changed: tr("The portal contact changed. Request a new code.", "تم تغيير جهة اتصال البوابة. اطلب رمزًا جديدًا."),
          verification_challenge_consumed: tr("This code has already been used. Reload to check contact status.", "استُخدم هذا الرمز سابقًا. أعد تحميل الصفحة للتحقق من حالة الاتصال."),
          verification_challenge_not_found: tr("Verification request not found. Request a new code.", "لم يُعثر على طلب التحقق. اطلب رمزًا جديدًا."),
          portal_unauthorized: tr("Your session expired. Sign in again.", "انتهت الجلسة. سجّل الدخول من جديد."),
        };
        setMessage(errors[result.error] || tr("Contact verification failed.", "فشل التحقق من جهة الاتصال."));
      } else {
        // Do not falsely claim success or retry an OTP that may be consumed.
        setRequiresReconciliation(true);
        setMessage(tr(
          "Verification status is unknown. Reload this page to check whether your contact was verified before trying again.",
          "حالة التحقق غير مؤكدة. أعد تحميل الصفحة لمعرفة ما إذا تم اعتماد جهة الاتصال قبل المحاولة مجددًا.",
        ));
      }
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  function selectChannel(next: VerificationChannel) {
    if (pending.current || requiresReconciliation) return;
    setChannel(next);
    setChallengeId("");
    setCode("");
    setDestination("");
    setMessage("");
  }

  return <section className="detail-card portal-contact-verification">
    <h2>{tr("Verify Report Delivery Contact", "التحقق من جهة اتصال تسليم التقارير")}</h2>
    <p className="muted">{tr(
      "Reports can be announced by email, SMS, or WhatsApp only after the corresponding portal contact is verified.",
      "يمكن إرسال إشعارات التقارير بالبريد أو SMS أو واتساب فقط بعد التحقق من جهة الاتصال المقابلة في البوابة.",
    )}</p>

    <div className="report-outbound-controls">
      <label>{tr("Verification channel", "قناة التحقق")}
        <select value={availableChannel} disabled={busy !== "" || requiresReconciliation} onChange={event => selectChannel(event.target.value as VerificationChannel)}>
          {hasUnverifiedEmail && <option value="EMAIL">{tr("Email", "البريد الإلكتروني")} · {email}</option>}
          {hasUnverifiedPhone && <option value="SMS">{tr("SMS / phone", "SMS / الهاتف")} · {phone}</option>}
        </select>
      </label>
      <button className="secondary-button" type="button" disabled={busy !== "" || requiresReconciliation} onClick={() => void requestCode()}>
        {busy === "request" ? tr("Queueing…", "جارٍ الإضافة…") : tr("Send Verification Code", "إرسال رمز التحقق")}
      </button>
    </div>

    {challengeId && <form className="report-outbound-controls" onSubmit={verify}>
      <label>{tr("Verification code", "رمز التحقق")}
        <input
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          required
        />
      </label>
      <button className="primary-button" disabled={busy !== "" || requiresReconciliation || code.length !== 6}>
        {busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Contact", "تحقق من جهة الاتصال")}
      </button>
      {destination && <small className="muted">{tr("Code destination", "وجهة الرمز")}: {destination}</small>}
    </form>}

    {message && <p className="muted" role="status" aria-live="polite">{message}</p>}
  </section>;
}
