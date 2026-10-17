import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { PortalChangePasswordForm } from "@/components/portal-change-password-form";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PortalChangePasswordPage() {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/login");
  if (!session.portalAccount.mustChangePassword) redirect("/portal");
  const locale = getUiLocale(session.portalAccount.preferredLocale);

  return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="detail-card public-auth-card">
      <p className="eyebrow">{tr(locale, "First sign in", "تسجيل الدخول الأول")}</p>
      <h1>{tr(locale, "Change your password", "تغيير كلمة المرور")}</h1>
      <p className="muted">{tr(locale, "Replace the temporary password before accessing portal data.", "استبدل كلمة المرور المؤقتة قبل الوصول إلى بيانات البوابة.")}</p>
      <PortalChangePasswordForm locale={locale} />
      <p className="muted">{tr(locale, "Your portal account stays restricted until a new password is saved.", "يبقى الوصول لبيانات حساب البوابة مقيّداً إلى أن يتم حفظ كلمة مرور جديدة.")}</p>
      <Link href="/portal/login" className="secondary-link">{tr(locale, "Return to portal sign in", "العودة إلى تسجيل دخول البوابة")}</Link>
    </section>
  </main>;
}
