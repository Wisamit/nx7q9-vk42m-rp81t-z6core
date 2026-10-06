"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalChangePasswordForm({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      setMessage(tr("Passwords do not match.", "كلمتا المرور غير متطابقتين."));
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/portal/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error === "password_too_short" ? tr("Use at least 12 characters.", "استخدم 12 محرفًا على الأقل.") : body.error || tr("Could not change password.", "تعذر تغيير كلمة المرور."));
      return;
    }
    router.replace("/portal");
    router.refresh();
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">{tr("New password", "كلمة المرور الجديدة")}<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label className="form-span">{tr("Confirm password", "تأكيد كلمة المرور")}<input name="confirm" type="password" minLength={12} autoComplete="new-password" required /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Set new password", "تعيين كلمة المرور الجديدة")}</button>
    {message && <p className="form-error form-span">{message}</p>}
  </form>;
}
