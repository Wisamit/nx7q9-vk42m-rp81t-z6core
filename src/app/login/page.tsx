import Image from "next/image";
import { StaffLoginForm } from "@/components/staff-login-form";
import { getSingleActiveOrganizationSystemSettings } from "@/lib/system-settings";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await getSingleActiveOrganizationSystemSettings();
  const locale = settings?.defaultLocale === "ar" ? "ar" : "en";
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const systemName = settings
    ? (locale === "ar" ? settings.systemNameAr || settings.systemNameEn : settings.systemNameEn || settings.systemNameAr)
    : "Family Lab LIS";

  return <main className="auth-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="auth-card">
      {settings?.logoDataUrl
        ? <Image className="auth-logo" src={settings.logoDataUrl} alt={systemName} width={220} height={110} unoptimized priority />
        : <div className="brand-mark">FL</div>}
      <p className="eyebrow">{systemName}</p>
      <h1>{tr("Sign in", "تسجيل الدخول")}</h1>
      <p className="muted">{tr("Multi-branch Laboratory Information System", "نظام معلومات المختبر متعدد الفروع")}</p>
      <StaffLoginForm locale={locale} />
    </section>
  </main>;
}
