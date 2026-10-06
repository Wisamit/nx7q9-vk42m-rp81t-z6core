import Image from "next/image";
import { PortalLoginForm } from "@/components/portal-login-form";
import { getSingleActiveOrganizationSystemSettings } from "@/lib/system-settings";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage() {
  const settings = await getSingleActiveOrganizationSystemSettings();
  const locale = settings?.defaultLocale === "ar" ? "ar" : "en";
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const systemName = settings
    ? (locale === "ar" ? settings.systemNameAr || settings.systemNameEn : settings.systemNameEn || settings.systemNameAr)
    : "Family Lab";

  return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="detail-card public-auth-card">
      {settings?.logoDataUrl
        ? <Image className="auth-logo" src={settings.logoDataUrl} alt={systemName} width={220} height={110} unoptimized priority />
        : <p className="eyebrow">{systemName}</p>}
      <h1>{tr("Portal Sign In", "تسجيل دخول البوابة")}</h1>
      <p className="muted">{tr("Secure access for patients, doctors and corporate clients.", "دخول آمن للمرضى والأطباء والعملاء من الشركات.")}</p>
      <PortalLoginForm locale={locale} />
    </section>
  </main>;
}
