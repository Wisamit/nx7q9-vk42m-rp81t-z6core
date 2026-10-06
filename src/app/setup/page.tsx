"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SetupLocale = "ar" | "en";

export default function SetupPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "saving" | "error">("checking");
  const [message, setMessage] = useState("");
  const [locale, setLocale] = useState<SetupLocale>("ar");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  useEffect(() => {
    const saved = window.localStorage.getItem("family-lab-setup-locale");
    const initial: SetupLocale = saved === "en" || saved === "ar"
      ? saved
      : navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
    setLocale(initial);

    fetch("/api/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.setupRequired) router.replace("/login");
        else setState("ready");
      })
      .catch(() => setState("error"));
  }, [router]);

  function toggleLocale() {
    const next: SetupLocale = locale === "ar" ? "en" : "ar";
    setLocale(next);
    window.localStorage.setItem("family-lab-setup-locale", next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      router.replace("/login?setup=complete");
      return;
    }

    const data = await response.json().catch(() => ({}));
    setMessage(data.error === "setup_already_completed"
      ? tr("The system has already been configured.", "تم إعداد النظام مسبقًا.")
      : tr("Could not save setup. Check the fields and try again.", "تعذر حفظ الإعدادات. تحقق من الحقول وحاول مجددًا."));
    setState("error");
  }

  if (state === "checking") {
    return <main className="auth-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="auth-card">{tr("Checking system setup…", "جارٍ التحقق من إعداد النظام…")}</div>
    </main>;
  }

  return (
    <main className="auth-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="auth-card wide">
        <div className="auth-locale-row">
          <div className="brand-mark">FL</div>
          <button type="button" className="secondary-button" onClick={toggleLocale}>
            {locale === "ar" ? "English" : "العربية"}
          </button>
        </div>
        <p className="eyebrow">Family Lab LIS</p>
        <h1>{tr("Initial System Setup", "الإعداد الأول للنظام")}</h1>
        <p className="muted">{tr(
          "Create the organization, main branch and system administrator account. This page is available only for the initial setup.",
          "أنشئ المؤسسة والفرع الرئيسي وحساب مدير النظام. هذه الصفحة تعمل مرة واحدة فقط.",
        )}</p>
        <form onSubmit={submit} className="form-grid">
          <label>{tr("Organization name (English)", "اسم المؤسسة بالإنجليزية")}<input name="organizationNameEn" required maxLength={200} /></label>
          <label>{tr("Organization name (Arabic)", "اسم المؤسسة بالعربية")}<input name="organizationNameAr" maxLength={200} dir="rtl" /></label>
          <label>{tr("Main branch name (English)", "اسم الفرع الرئيسي بالإنجليزية")}<input name="branchNameEn" required maxLength={200} /></label>
          <label>{tr("Main branch name (Arabic)", "اسم الفرع الرئيسي بالعربية")}<input name="branchNameAr" maxLength={200} dir="rtl" /></label>
          <label>{tr("Administrator name (English)", "اسم المدير بالإنجليزية")}<input name="displayNameEn" required maxLength={200} /></label>
          <label>{tr("Administrator name (Arabic)", "اسم المدير بالعربية")}<input name="displayNameAr" maxLength={200} dir="rtl" /></label>
          <label>{tr("Username", "اسم المستخدم")}<input name="username" required minLength={3} maxLength={100} autoCapitalize="none" /></label>
          <label>{tr("Password", "كلمة المرور")}<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>{tr("At least 12 characters.", "12 محرفًا على الأقل.")}</small></label>
          {message && <p className="form-error">{message}</p>}
          <button className="primary-button" type="submit" disabled={state === "saving"}>
            {state === "saving" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create System", "إنشاء النظام")}
          </button>
        </form>
      </section>
    </main>
  );
}
