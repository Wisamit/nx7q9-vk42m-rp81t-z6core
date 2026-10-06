"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalLoginForm({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationCode: form.get("organizationCode"),
        login: form.get("login"),
        password: form.get("password"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error === "portal_account_temporarily_locked"
        ? tr("Account temporarily locked after repeated failed attempts.", "تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة متكررة.")
        : tr("Invalid portal credentials.", "بيانات دخول البوابة غير صحيحة."));
      return;
    }
    router.replace(body.mustChangePassword ? "/portal/change-password" : "/portal");
    router.refresh();
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">{tr("Laboratory code", "رمز المختبر")}<input name="organizationCode" autoCapitalize="characters" required placeholder="FAMILY_LAB" /></label>
    <label className="form-span">{tr("Email or phone", "البريد الإلكتروني أو الهاتف")}<input name="login" autoComplete="username" required /></label>
    <label className="form-span">{tr("Password", "كلمة المرور")}<input name="password" type="password" autoComplete="current-password" required /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Signing in…", "جارٍ تسجيل الدخول…") : tr("Sign in", "تسجيل الدخول")}</button>
    {message && <p className="form-error form-span">{message}</p>}
  </form>;
}
