import { requirePermission } from "@/lib/auth";
import { getOrganizationSystemSettings } from "@/lib/system-settings";
import Link from "next/link";
import { SystemSettingsDialog } from "@/components/system-settings-dialog";
import { SystemDateText } from "@/components/system-date-text";
import { SystemIcon } from "@/components/system-icon";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePermission("settings.manage");
  const settings = await getOrganizationSystemSettings(session.user.organizationId);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p>
        <h1>{locale === "ar" ? "إعدادات النظام" : "System Settings"}</h1>
        <p className="muted">{locale === "ar"
          ? "إدارة هوية المركز، المظهر، المنطقة الزمنية، تنسيقات التاريخ والوقت والإعدادات العامة."
          : "Manage center identity, appearance, timezone, date/time formats and system-wide defaults."}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/settings/specimens"><SystemIcon name="specimen" size={15} />{locale === "ar" ? "إعدادات العينات" : "Specimen Settings"}</Link>
        <Link className="secondary-link" href="/security"><SystemIcon name="security" size={15} />{locale === "ar" ? "الأمان والملف الشخصي" : "Security & Profile"}</Link>
      </div>
    </header>
    <section className="detail-card"><h2>{locale === "ar" ? "معاينة التاريخ والوقت الحاليين" : "Current date and time preview"}</h2><p className="muted">{locale === "ar" ? "المعاينة حسب تنسيق النظام المحفوظ والمنطقة الزمنية للمؤسسة." : "Preview of saved organization date/time format and timezone."}</p><p><SystemDateText value={new Date().toISOString()} timeZone={settings.timezone} /></p></section>
    <SystemSettingsDialog initial={settings} locale={locale} />
  </main>;
}
