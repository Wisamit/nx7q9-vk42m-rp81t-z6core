import { OrganizationThemeOverride } from "@/components/organization-theme-override";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { getOrganizationSystemSettings } from "@/lib/system-settings";

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentPortalSession();
  const settings = session
    ? await getOrganizationSystemSettings(session.portalAccount.organizationId)
    : null;

  return <>
    {settings && <OrganizationThemeOverride settings={settings} />}
    {children}
  </>;
}
