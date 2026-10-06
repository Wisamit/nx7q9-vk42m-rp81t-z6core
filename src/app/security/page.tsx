import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { SecuritySettings } from "@/components/security-settings";
import { SystemIcon } from "@/components/system-icon";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requireSession();
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr("Settings", "الإعدادات")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="security" size={25} />{tr("Security & Profile", "الأمان والملف الشخصي")}</h1>
        <p className="muted">{tr(
          "Manage your profile picture and multi-factor authentication. Security changes are audit logged.",
          "إدارة صورتك الشخصية والمصادقة متعددة العوامل. جميع تغييرات الأمان مسجلة في سجل التدقيق."
        )}</p>
      </div>
      <Link className="secondary-link" href="/settings"><SystemIcon name="settings" size={15} />{tr("System Settings", "إعدادات النظام")}</Link>
    </header>
    <SecuritySettings
      locale={locale}
      avatarDataUrl={session.user.avatarDataUrl}
      displayName={locale === "ar" ? session.user.displayNameAr || session.user.displayNameEn : session.user.displayNameEn}
      mfaEnabled={session.user.mfaEnabled}
      mfaConfirmedAt={session.user.mfaConfirmedAt?.toISOString() || null}
    />
  </main>;
}
