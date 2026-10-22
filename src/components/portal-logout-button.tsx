"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { submitSignOut } from "@/lib/auth-form-transport";

export function PortalLogoutButton({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");
  const inFlight = useRef(false);
  const label = locale === "ar" ? "تسجيل الخروج" : "Sign out";

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setWarning("");
    try {
      const outcome = await submitSignOut("portal");
      if (outcome.kind === "signed_out") {
        router.replace("/portal/login");
        router.refresh();
        return;
      }
      // The account may still have an active portal cookie and server session.
      // Do not redirect or silently retry an unacknowledged sign-out.
      setWarning(locale === "ar"
        ? "لم يتم تأكيد تسجيل الخروج من البوابة. قد تبقى الجلسة فعّالة. أعد المحاولة ولا تترك الجهاز دون مراقبة."
        : "Portal sign-out was not confirmed. Your session may still be active. Retry and do not leave this device unattended.");
    } catch {
      setWarning(locale === "ar"
        ? "تعذر تأكيد تسجيل الخروج. أعد المحاولة ولا تترك الجهاز دون مراقبة."
        : "Could not confirm sign-out. Retry and do not leave this device unattended.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void logout()}>
      {busy ? "…" : label}
    </button>
    {warning && <p className="form-error" role="alert">{warning}</p>}
  </>;
}
