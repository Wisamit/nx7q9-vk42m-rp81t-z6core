"use client";

import { FormEvent, useRef, useState } from "react";
import { submitPortalPasswordChange } from "@/lib/auth-form-transport";
import { useRouter } from "next/navigation";

export function PortalChangePasswordForm({ locale }: { locale: "ar" | "en" }) {
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
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      setMessage(tr("Passwords do not match.", "كلمتا المرور غير متطابقتين."));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const outcome = await submitPortalPasswordChange(password);
      if (outcome.kind === "changed") {
        router.replace("/portal");
        router.refresh();
        return;
      }
      if (outcome.kind === "uncertain") {
        // The password may have changed and may have invalidated an earlier
        // login state despite a missing network acknowledgement.
        uncertain.current = true;
        setRequiresReconciliation(true);
        setMessage(tr(
          "Password-change status is unknown. Reload and check your portal session before trying again.",
          "حالة تغيير كلمة المرور غير مؤكدة. أعد تحميل الصفحة وتحقق من جلسة البوابة قبل المحاولة مجددًا.",
        ));
        return;
      }
      setMessage(outcome.error === "password_too_short"
        ? tr("Use at least 12 characters.", "استخدم 12 محرفًا على الأقل.")
        : tr("Could not change password.", "تعذر تغيير كلمة المرور."));
    } catch {
      uncertain.current = true;
      setRequiresReconciliation(true);
      setMessage(tr("Password-change status is unknown. Reload before trying again.", "حالة تغيير كلمة المرور غير مؤكدة. أعد تحميل الصفحة قبل المحاولة مجددًا."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">{tr("New password", "كلمة المرور الجديدة")}<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label className="form-span">{tr("Confirm password", "تأكيد كلمة المرور")}<input name="confirm" type="password" minLength={12} autoComplete="new-password" required /></label>
    <button className="primary-button form-span" disabled={busy || requiresReconciliation}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Set new password", "تعيين كلمة المرور الجديدة")}</button>
    {message && <p className="form-error form-span" role="alert">{message}</p>}
  </form>;
}
