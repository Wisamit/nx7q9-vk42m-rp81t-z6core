"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "saving" | "error">("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.setupRequired) router.replace("/login");
        else setState("ready");
      })
      .catch(() => setState("error"));
  }, [router]);

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
    setMessage(data.error === "setup_already_completed" ? "تم إعداد النظام مسبقًا." : "تعذر حفظ الإعدادات. تحقق من الحقول وحاول مجددًا.");
    setState("error");
  }

  if (state === "checking") return <main className="auth-shell" dir="rtl"><div className="auth-card">جارٍ التحقق من إعداد النظام…</div></main>;

  return (
    <main className="auth-shell" dir="rtl">
      <section className="auth-card wide">
        <div className="brand-mark">FL</div>
        <p className="eyebrow">Family Lab LIS</p>
        <h1>الإعداد الأول للنظام</h1>
        <p className="muted">أنشئ المؤسسة والفرع الرئيسي وحساب مدير النظام. هذه الصفحة تعمل مرة واحدة فقط.</p>
        <form onSubmit={submit} className="form-grid">
          <label>اسم المؤسسة بالإنجليزية<input name="organizationNameEn" required maxLength={200} /></label>
          <label>اسم المؤسسة بالعربية<input name="organizationNameAr" maxLength={200} /></label>
          <label>اسم الفرع الرئيسي بالإنجليزية<input name="branchNameEn" required maxLength={200} /></label>
          <label>اسم الفرع الرئيسي بالعربية<input name="branchNameAr" maxLength={200} /></label>
          <label>اسم المدير بالإنجليزية<input name="displayNameEn" required maxLength={200} /></label>
          <label>اسم المدير بالعربية<input name="displayNameAr" maxLength={200} /></label>
          <label>اسم المستخدم<input name="username" required minLength={3} maxLength={100} autoCapitalize="none" /></label>
          <label>كلمة المرور<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>12 محرفًا على الأقل.</small></label>
          {message && <p className="form-error">{message}</p>}
          <button className="primary-button" type="submit" disabled={state === "saving"}>{state === "saving" ? "جارٍ الحفظ…" : "إنشاء النظام"}</button>
        </form>
      </section>
    </main>
  );
}
