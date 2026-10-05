"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    if (response.ok) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    const data = await response.json().catch(() => ({}));
    setError(data.error === "account_temporarily_locked"
      ? "تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة. حاول لاحقًا."
      : "اسم المستخدم أو كلمة المرور غير صحيحة.");
    setLoading(false);
  }

  return (
    <main className="auth-shell" dir="rtl">
      <section className="auth-card">
        <div className="brand-mark">FL</div>
        <p className="eyebrow">Family Lab LIS</p>
        <h1>تسجيل الدخول</h1>
        <p className="muted">نظام معلومات المختبر متعدد الفروع</p>
        <form onSubmit={submit} className="form-stack">
          <label>اسم المستخدم<input name="username" required autoComplete="username" autoCapitalize="none" /></label>
          <label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>{loading ? "جارٍ تسجيل الدخول…" : "دخول"}</button>
        </form>
      </section>
    </main>
  );
}
