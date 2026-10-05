"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);

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
        : {
            username: form.get("username"),
            password: form.get("password"),
          }),
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

    if (data.error === "rate_limited") {
      setError("تم تجاوز عدد المحاولات المسموح بها مؤقتًا. حاول بعد عدة دقائق.");
    } else if (data.error === "account_temporarily_locked") {
      setError("تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة. حاول لاحقًا.");
    } else if (mfaRequired) {
      setError("رمز التحقق غير صحيح أو انتهت صلاحية جلسة التحقق.");
    } else {
      setError("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }
    setLoading(false);
  }

  function restart() {
    setMfaRequired(false);
    setError("");
  }

  return (
    <main className="auth-shell" dir="rtl">
      <section className="auth-card">
        <div className="brand-mark">FL</div>
        <p className="eyebrow">Family Lab LIS</p>
        <h1>{mfaRequired ? "التحقق بخطوتين" : "تسجيل الدخول"}</h1>
        <p className="muted">{mfaRequired
          ? "أدخل رمز تطبيق المصادقة المكون من 6 أرقام، أو أحد رموز الاسترداد."
          : "نظام معلومات المختبر متعدد الفروع"}</p>
        <form onSubmit={submit} className="form-stack">
          {mfaRequired ? <>
            <label>رمز التحقق
              <input
                name="code"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                maxLength={16}
              />
            </label>
            <button className="secondary-button" type="button" onClick={restart} disabled={loading}>العودة لتسجيل الدخول</button>
          </> : <>
            <label>اسم المستخدم<input name="username" required autoComplete="username" autoCapitalize="none" /></label>
            <label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label>
          </>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>
            {loading ? "جارٍ التحقق…" : mfaRequired ? "تحقق ودخول" : "دخول"}
          </button>
        </form>
      </section>
    </main>
  );
}
