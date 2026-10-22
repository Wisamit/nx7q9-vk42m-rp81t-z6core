"use client";

import { FormEvent, useRef, useState } from "react";
import { submitStaffSignIn } from "@/lib/auth-form-transport";
import { useRouter } from "next/navigation";

export function StaffLoginForm({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [requiresReconciliation, setRequiresReconciliation] = useState(false);
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain.current || requiresReconciliation) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const outcome = await submitStaffSignIn({
        code: form.get("code"),
        username: form.get("username"),
        password: form.get("password"),
      }, mfaRequired);
      if (outcome.kind === "authenticated") {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      if (outcome.kind === "mfa_required") {
        setMfaRequired(true);
        return;
      }
      if (outcome.kind === "uncertain") {
        // Authentication or MFA may have succeeded even if its response
        // disappeared. Never claim success or retry blindly.
        uncertain.current = true;
        setRequiresReconciliation(true);
        setError(tr(
          "Sign-in status is unknown. Check your session by reopening the dashboard or reload before making another attempt.",
          "حالة تسجيل الدخول غير مؤكدة. تحقق من الجلسة بفتح لوحة التحكم أو أعد تحميل الصفحة قبل محاولة جديدة.",
        ));
        return;
      }
      if (outcome.error === "rate_limited")
        setError(tr("Too many attempts. Try again in a few minutes.", "تم تجاوز عدد المحاولات المسموح بها مؤقتًا. حاول بعد عدة دقائق."));
      else if (outcome.error === "account_temporarily_locked")
        setError(tr("The account is temporarily locked after failed sign-in attempts.", "تم قفل الحساب مؤقتًا بعد محاولات دخول فاشلة. حاول لاحقًا."));
      else if (mfaRequired)
        setError(tr("The verification code is invalid or the challenge expired.", "رمز التحقق غير صحيح أو انتهت صلاحية جلسة التحقق."));
      else setError(tr("Invalid username or password.", "اسم المستخدم أو كلمة المرور غير صحيحة."));
    } catch {
      uncertain.current = true;
      setRequiresReconciliation(true);
      setError(tr(
        "Sign-in status is unknown. Reload before retrying.",
        "حالة تسجيل الدخول غير مؤكدة. أعد تحميل الصفحة قبل المحاولة مجددًا.",
      ));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function restart() {
    if (inFlight.current || uncertain.current) return;
    setMfaRequired(false);
    setError("");
  }

  return <form onSubmit={submit} className="form-stack">
    {mfaRequired ? <>
      <label>{tr("Verification code", "رمز التحقق")}
        <input name="code" required autoComplete="one-time-code" inputMode="numeric" autoFocus maxLength={16} />
      </label>
      <button className="secondary-button" type="button" onClick={restart} disabled={loading || requiresReconciliation}>{tr("Back to sign in", "العودة لتسجيل الدخول")}</button>
    </> : <>
      <label>{tr("Username", "اسم المستخدم")}<input name="username" required autoComplete="username" autoCapitalize="none" /></label>
      <label>{tr("Password", "كلمة المرور")}<input name="password" type="password" required autoComplete="current-password" /></label>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={loading || requiresReconciliation}>
      {loading ? tr("Checking…", "جارٍ التحقق…") : mfaRequired ? tr("Verify and sign in", "تحقق ودخول") : tr("Sign in", "دخول")}
    </button>
  </form>;
}
