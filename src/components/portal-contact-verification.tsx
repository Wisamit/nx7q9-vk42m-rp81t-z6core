"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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

  const hasUnverifiedEmail = Boolean(email && !emailVerifiedAt);
  const hasUnverifiedPhone = Boolean(phone && !phoneVerifiedAt);
  if (!hasUnverifiedEmail && !hasUnverifiedPhone) return null;

  async function requestCode() {
    setBusy("request");
    setMessage("");
    const response = await fetch("/api/portal/auth/contact-verification/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      challengeId?: string;
      destination?: string;
    };
    setBusy("");
    if (!response.ok) {
      const errors: Record<string, string> = {
        rate_limited: tr("Too many verification requests. Try again later.", "عدد محاولات التحقق كبير. حاول لاحقًا."),
        portal_email_missing: tr("No email is configured for this portal account.", "لا يوجد بريد إلكتروني مهيأ لهذا الحساب."),
        portal_phone_missing: tr("No phone is configured for this portal account.", "لا يوجد رقم هاتف مهيأ لهذا الحساب."),
      };
      setMessage(errors[body.error || ""] || tr("Could not queue verification code.", "تعذر إضافة رمز التحقق إلى قائمة الإرسال."));
      return;
    }
    setChallengeId(body.challengeId || "");
    setDestination(body.destination || "");
    setMessage(tr(
      "Verification code queued. If your organization uses manual notification dispatch, an administrator must dispatch the outbound queue.",
      "تمت إضافة رمز التحقق إلى قائمة الإرسال. إذا كانت المؤسسة تستخدم الإرسال اليدوي فيجب على المسؤول تشغيل قائمة الصادر.",
    ));
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId || code.trim().length !== 6) return;
    setBusy("verify");
    setMessage("");
    const response = await fetch("/api/portal/auth/contact-verification/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setBusy("");
    if (!response.ok) {
      const errors: Record<string, string> = {
        invalid_verification_code: tr("The verification code is invalid.", "رمز التحقق غير صحيح."),
        verification_code_expired: tr("The verification code expired. Request a new one.", "انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا."),
        verification_attempts_exceeded: tr("Too many incorrect attempts. Request a new code.", "عدد المحاولات الخاطئة كبير. اطلب رمزًا جديدًا."),
        verification_destination_changed: tr("The portal contact changed. Request a new code.", "تم تغيير جهة اتصال البوابة. اطلب رمزًا جديدًا."),
      };
      setMessage(errors[body.error || ""] || tr("Contact verification failed.", "فشل التحقق من جهة الاتصال."));
      return;
    }
    setMessage(tr("Contact verified.", "تم التحقق من جهة الاتصال."));
    setChallengeId("");
    setCode("");
    router.refresh();
  }

  return <section className="detail-card portal-contact-verification">
    <h2>{tr("Verify Report Delivery Contact", "التحقق من جهة اتصال تسليم التقارير")}</h2>
    <p className="muted">{tr(
      "Reports can be announced by email, SMS, or WhatsApp only after the corresponding portal contact is verified.",
      "يمكن إرسال إشعارات التقارير بالبريد أو SMS أو واتساب فقط بعد التحقق من جهة الاتصال المقابلة في البوابة.",
    )}</p>

    <div className="report-outbound-controls">
      <label>{tr("Verification channel", "قناة التحقق")}
        <select value={channel} onChange={event => setChannel(event.target.value as VerificationChannel)}>
          {hasUnverifiedEmail && <option value="EMAIL">{tr("Email", "البريد الإلكتروني")} · {email}</option>}
          {hasUnverifiedPhone && <option value="SMS">{tr("SMS / phone", "SMS / الهاتف")} · {phone}</option>}
        </select>
      </label>
      <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void requestCode()}>
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
      <button className="primary-button" disabled={busy !== "" || code.length !== 6}>
        {busy === "verify" ? tr("Verifying…", "جارٍ التحقق…") : tr("Verify Contact", "تحقق من جهة الاتصال")}
      </button>
      {destination && <small className="muted">{tr("Code destination", "وجهة الرمز")}: {destination}</small>}
    </form>}

    {message && <p className="muted">{message}</p>}
  </section>;
}
