import { PublicThemeRuntime } from "@/components/public-theme-runtime";
import { buildThemeCss, type SystemSettings } from "@/lib/system-settings";

export function OrganizationThemeOverride({ settings }: { settings: SystemSettings }) {
  return <>
    <style
      id="organization-theme-override"
      dangerouslySetInnerHTML={{ __html: buildThemeCss(settings) }}
    />
    <PublicThemeRuntime
      defaultTheme={settings.defaultTheme}
      faviconDataUrl={settings.faviconDataUrl}
    />
  </>;
}
