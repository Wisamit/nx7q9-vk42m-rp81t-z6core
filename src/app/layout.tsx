import type { Metadata } from "next";
import "./globals.css";
import packageJson from "../../package.json";
import { SystemShell } from "@/components/system-shell";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { buildThemeCss, getOrganizationSystemSettings, getSingleActiveOrganizationSystemSettings, SYSTEM_DEVELOPER_CREDIT } from "@/lib/system-settings";

export const metadata: Metadata = {
  title: {
    default: "Family Lab LIS",
    template: "%s · Family Lab LIS",
  },
  description: "Multi-branch Laboratory Information System",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const settings = session
    ? await getOrganizationSystemSettings(session.user.organizationId)
    : await getSingleActiveOrganizationSystemSettings();
  const locale = session
    ? (session.user.preferredLocale === "ar" ? "ar" : "en")
    : (settings?.defaultLocale === "ar" ? "ar" : "en");
  const direction = locale === "ar" ? "rtl" : "ltr";
  const initialTheme = settings?.defaultTheme === "DARK" ? "dark" : "light";
  const systemName = settings
    ? (locale === "ar" ? settings.systemNameAr || settings.systemNameEn : settings.systemNameEn || settings.systemNameAr)
    : "Family Lab";

  const body = session && settings ? <SystemShell
    user={{
      displayName: session.user.displayNameAr && locale === "ar"
        ? session.user.displayNameAr
        : session.user.displayNameEn || session.user.displayNameAr || session.user.username,
      organizationName: locale === "ar"
        ? session.user.organization.nameAr || session.user.organization.nameEn
        : session.user.organization.nameEn || session.user.organization.nameAr || session.user.organization.code,
      preferredLocale: locale,
      activeBranchId: session.activeBranchId,
      branches: session.user.branchScopes
        .filter(scope => scope.branch.status === "ACTIVE")
        .map(scope => ({
          id: scope.branch.id,
          code: scope.branch.code,
          name: locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn || scope.branch.nameAr || scope.branch.code,
        })),
      permissions: [...permissionSet(session)],
      avatarDataUrl: session.user.avatarDataUrl,
    }}
    appearance={{
      systemName,
      logoDataUrl: settings.logoDataUrl,
      defaultTheme: settings.defaultTheme,
      timezone: settings.timezone,
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
      showSeconds: settings.showSeconds,
      developerCredit: SYSTEM_DEVELOPER_CREDIT,
      appVersion: packageJson.version,
    }}
  >{children}</SystemShell> : children;

  return <html
    lang={locale}
    dir={direction}
    data-theme={initialTheme}
    data-density={settings?.density === "COMPACT" ? "compact" : "comfortable"}
    data-date-format={settings?.dateFormat || "DD/MM/YYYY"}
    data-timezone={settings?.timezone || "UTC"}
    data-time-format={settings?.timeFormat || "24"}
    data-show-seconds={settings?.showSeconds ? "true" : "false"}
  >
    <head>
      {settings && <style id="organization-theme" dangerouslySetInnerHTML={{ __html: buildThemeCss(settings) }} />}
      <link rel="icon" href={settings?.faviconDataUrl || "/favicon.ico"} />
      <meta name="application-name" content={systemName} />
    </head>
    <body>{body}</body>
  </html>;
}
