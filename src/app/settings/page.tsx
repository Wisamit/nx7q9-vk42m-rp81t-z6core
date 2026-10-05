import { requirePermission } from "@/lib/auth";
import { getOrganizationSystemSettings } from "@/lib/system-settings";
import { SystemSettingsForm } from "@/components/system-settings-form";

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
    </header>
    <SystemSettingsForm initial={settings} locale={locale} />
  </main>;
}
