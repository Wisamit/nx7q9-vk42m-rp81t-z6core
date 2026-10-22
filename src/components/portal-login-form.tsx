"use client";

import { FormEvent, useRef, useState } from "react";
import { submitPortalSignIn } from "@/lib/auth-form-transport";
import { useRouter } from "next/navigation";

export function PortalLoginForm({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const inFlight = useRef(false);
  const uncertain = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain.current || requiresReconciliation) return;
    const form = new FormData(event.currentTarget);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const outcome = await submitPortalSignIn({
        organizationCode: form.get("organizationCode"),
        login: form.get("login"),
        password: form.get("password"),
      });
      if (outcome.kind === "authenticated") {
        router.replace(outcome.mustChangePassword ? "/portal/change-password" : "/portal");
        router.refresh();
        return;
      }
      if (outcome.kind === "uncertain") {
        uncertain.current = true;
        setRequiresReconciliation(true);
        setMessage(tr(
          "Sign-in status is unknown. Check your portal session or reload this page before trying again.",
          "حالة تسجيل الدخول غير مؤكدة. تحقق من جلسة البوابة أو أعد تحميل الصفحة قبل المحاولة مجددًا.",
        ));
        return;
      }
      setMessage(outcome.error === "portal_account_temporarily_locked"
        ? tr("Account temporarily locked after repeated failed attempts.", "تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة متكررة.")
        : outcome.error === "rate_limited"
        ? tr("Too many attempts. Try again later.", "محاولات كثيرة جدًا. حاول لاحقًا.")
        : tr("Invalid portal credentials.", "بيانات دخول البوابة غير صحيحة."));
    } catch {
      uncertain.current = true;
      setRequiresReconciliation(true);
      setMessage(tr("Sign-in status is unknown. Reload before trying again.", "حالة الدخول غير مؤكدة. أعد تحميل الصفحة قبل المحاولة مجددًا."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">{tr("Laboratory code", "رمز المختبر")}<input name="organizationCode" autoCapitalize="characters" required placeholder="FAMILY_LAB" /></label>
    <label className="form-span">{tr("Email or phone", "البريد الإلكتروني أو الهاتف")}<input name="login" autoComplete="username" required /></label>
    <label className="form-span">{tr("Password", "كلمة المرور")}<input name="password" type="password" autoComplete="current-password" required /></label>
    <button className="primary-button form-span" disabled={busy || requiresReconciliation}>{busy ? tr("Signing in…", "جارٍ تسجيل الدخول…") : tr("Sign in", "تسجيل الدخول")}</button>
    {message && <p className="form-error form-span" role="alert">{message}</p>}
  </form>;
}
