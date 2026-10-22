"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { submitSignOut } from "@/lib/auth-form-transport";

export function LogoutButton({
  label = "تسجيل الخروج",
  locale = "ar",
}: {
  label?: string;
  locale?: "ar" | "en";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const inFlight = useRef(false);

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setWarning("");
    try {
      const result = await submitSignOut("staff");
      if (result.kind === "signed_out") {
        router.replace("/login");
        router.refresh();
        return;
      }
      // Never display a login page as proof of logout if server revocation
      // was not acknowledged. A manual retry is safe and deliberately opt-in.
      setWarning(locale === "ar"
        ? "لم يتم تأكيد تسجيل الخروج. قد تبقى الجلسة فعّالة. أعد المحاولة ولا تترك الجهاز دون مراقبة."
        : "Sign-out was not confirmed. Your session may still be active. Retry and do not leave this device unattended.");
    } catch {
      setWarning(locale === "ar"
        ? "تعذر تأكيد تسجيل الخروج. أعد المحاولة ولا تترك الجهاز دون مراقبة."
        : "Could not confirm sign-out. Retry and do not leave this device unattended.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return <>
    <button className="secondary-button" type="button" onClick={() => void logout()} disabled={loading}>
      {loading ? "…" : label}
    </button>
    {warning && <p className="form-error" role="alert">{warning}</p>}
  </>;
}
