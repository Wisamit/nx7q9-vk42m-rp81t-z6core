"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function StaffLoginForm({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    const response = await fetch(mfaRequired ? "/api/auth/mfa/verify" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mfaRequired
        ? { code: form.get("code") }
        : { username: form.get("username"), password: form.get("password") }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && !data.mfaRequired) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }
    if (response.status === 202 && data.mfaRequired) {
      setMfaRequired(true);
      setLoading(false);
      return;
    }

    if (data.error === "rate_limited") setError(tr("Too many attempts. Try again in a few minutes.", "تم تجاوز عدد المحاولات المسموح بها مؤقتًا. حاول بعد عدة دقائق."));
    else if (data.error === "account_temporarily_locked") setError(tr("The account is temporarily locked after failed sign-in attempts.", "تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة. حاول لاحقًا."));
    else if (mfaRequired) setError(tr("The verification code is invalid or the challenge expired.", "رمز التحقق غير صحيح أو انتهت صلاحية جلسة التحقق."));
    else setError(tr("Invalid username or password.", "اسم المستخدم أو كلمة المرور غير صحيحة."));
    setLoading(false);
  }

  function restart() {
    setMfaRequired(false);
    setError("");
  }

  return <form onSubmit={submit} className="form-stack">
    {mfaRequired ? <>
      <label>{tr("Verification code", "رمز التحقق")}
        <input name="code" required autoComplete="one-time-code" inputMode="numeric" autoFocus maxLength={16} />
      </label>
      <button className="secondary-button" type="button" onClick={restart} disabled={loading}>{tr("Back to sign in", "العودة لتسجيل الدخول")}</button>
    </> : <>
      <label>{tr("Username", "اسم المستخدم")}<input name="username" required autoComplete="username" autoCapitalize="none" /></label>
      <label>{tr("Password", "كلمة المرور")}<input name="password" type="password" required autoComplete="current-password" /></label>
    </>}
    {error && <p className="form-error">{error}</p>}
    <button className="primary-button" disabled={loading}>
      {loading ? tr("Checking…", "جارٍ التحقق…") : mfaRequired ? tr("Verify and sign in", "تحقق ودخول") : tr("Sign in", "دخول")}
    </button>
  </form>;
}
