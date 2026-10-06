import { prisma } from "@/lib/db";

export type ThemePalette = {
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceSoft: string;
  surfaceRaised: string;
  surfaceHover: string;
  text: string;
  textSubtle: string;
  onPrimary: string;
  muted: string;
  border: string;
  sidebar: string;
  sidebarText: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

export const SYSTEM_DEVELOPER_CREDIT = "WISAM A.I";

export const DEFAULT_LOGO_DATA_URL = "data:image/webp;base64,UklGRjAPAABXRUJQVlA4ICQPAACwQACdASqfALAAPmEuk0YkIqGhJBbceIAMCWIA1E4Tf0nXlyz6X/F/lP7aNo/w34V/IXnTzJdjP5T82P7R89/R5+j/957gf6r/6z7QO6f+0HqA/aL/d+zL6NvQG/n/9M9Jn2kv2w9gD9pPTH/a/4Uv2g/bz2qv/brHfi3/JdoP966M3zaod/Fftz+R/t37efld8md9vxz1Avxf+b/578qeEzAF+if1n/g+FZqQd/f8x7gH83/qH+n41qgB/PP7F/1P7Z7sn9Z+0XoG/P/85/6/858Bf84/sf/S/wPth+0T0WP3IaxVuNIXu7vipXFFqV4aAp47Crf9gtBy0Tbk8J/kEb2fcDX7CQw//hdz9YNogpbP6c2DqkxmXsC4KXsmX4LffnpRfBqNbxN2izs+4WhYGAr/2HoZNIptvP2SF6ZKNLJxpq7xWNsAuMcGW9tW037HRDKqH8xaQKq1ARCZJbLyqrsFqCIJhuiJzjKoXuxAd1Ryg9TyN8dVVhlRVP6DI751XLg7nzlVrRaOtmlxQWTkNf7nczDrN4PdP+VGlfRyPLj+/7RQWY5JNZkdBTCkz2wQlh1ZzJkoELxnwt6hJJNbfFQxVAC5xVOVLjq4tHZZ59HvRw4tdKXY8HQzKAcg5f5dM7JNtiYreao0gYrMSGwttRwJioZVjvPF19/8iHW0lntWZ7N6CKOOcAhi1vQAAP7+VdBLsQgUP9P7Wb1zqq/mQls4mzcX898xiZBTQdULemwyX7qb77m1rZIwpzxcCVdWjgF9DS4DYWhi80d0jLl/EWN5lmKq+FruosBvAAft6ywAn1h2/DOxMRogAbyBedY3vF1RDoU65XiPQQapynRcbjuT/gRfEDm7tkiScgaCkYmAfOGDqMqduTr7xFFCvLXw1Tfv+lwq4n76LV5VO8etmPF4DO3nYqElqw7N6IbEOm94P3ju3RvrXSF/uwaDqB+rhukOS3BIoUTYWc7dZY1Eczfxp8I05k4Y+LKaSIJsiM1d3+c905CagUdSrY4omdD7pxiU8aC9GIfhDy1Mr9gRMmtiq7UxUQCxYWhyFFFOC0KaghsXjBAKxfy4Rqi14TJM2/b4GpXfgnuTUwyd38Zy26F/048+Qq2k87FhGQ3HKm3ocy6b8v5hJByucymWVSza4T1dvmgyX65lNXnMGUnDgvCoh31o53j4ro199KXV+W+Z2yoKWk5398lCGBkIlhn7d5irmli3fx+rf+dB6vQAcWer4UdZEC6U7zDv+5BvpQnoqA4RxnTVH/zb/IfDzSqSocPznYKfwAvoHUvbU+8C/k2cnq8O4dyGN+8DWeos8NQ3WpFVZGGBrOdRJDLWrMMGG+CkO4mSnnd/jlUxRjxkvIpjotjVihGFcEyErBUYYkoflyqYxwLUxram5RymzwJkJv7LuPcxhZSgR64uHbluGr1ngmBA0JmJMovG5HB4RvvpGmzNE3XpK6kdaLGTY0jDJ3ocm/+JjvgXmHlBfX1JRSjPi5mZJLhK+BssGF3Z8IRYRrMUdu5vnJBEHfvDdOfwWYJLLSW4FrWolfVYQnbCOKWIe0keImxXKHUefBGa1ZSODdaFHvhA44vo5Wnu0u9nDZP346kWXVWWDHm+OlBV7RgS9axpWodXi3lKJJuFwjN7De3Gj7SjraaFixH5mSYM9SOxcXoOKFIor3B+fsPQW4sKT7CscD8+xf8OV+YeoCFz8B2Q7kXoinD0uq0FdfxPdYtyVaN4QsKr60r6NC4m+coL7NQWsCmQ/5f/oOqTc55qkqpMCHLdLMpyrza/7tOnfZa0UwUwTHTTSqfafyAy5GsWIxWI+wpmeLKlRcJDRXaX5aj/XJkFd6wdzDFhH2gvVElTeEsEevM+jdzfwQZ/bWuVIQsLgRxbxajK7rUQAT5Y61tWccqlrHyrcywhG5fIdXNcMpIw8ritreiSP1qSSpFHVtQGDSWALcyTEDWJHxVI/Drd8m0gFgZ/phHRtFm338a2GnjDfEHPijEkhWEF4VE20UcxKeXETOd3mTuKMUhjfCNQvB91BwjxEs8BHoU5j/8/7MESZjOLCA6+QL4i6eOQNCeIZsF8scYJw3z008T1Bo36dJbmO+4MoQZfvLZFc+ZqlxTI2kzYMx6PFK6RuhHQpudpNHuq6TNOT5zjmbGmMfJM2ut5HZEebvEGh01/6TaMt3CP/OYxxGQ/kAwb9o2wBAHtKSBrqXIOdiCsCQDtVRcm1UV6JmonKeGbz24Xt8JjOj8lmiiJI83zKtf4cKLCDBmUV9K4ihgMhRlIvh1V0LAdx1m+BUfbcHcjL8p0q2smNNS+w/d2nABNh3YkDLmjr+UbMVzsZHCT3zRfqOOq6jk2HBChPJMlbJ/Nz9mHlDM7QfaDp+WaLw8FxF07cEa2TEsG6d3/ZY8URvSjqAXgLaqqQv5lmWuh/j4jbx17Mb9KFOYQU/n3l5JHQsxEgkUbCoG/2EMFk31BJhbAENr7vK+sk+NDtF7CpSg64vBx8IK1mCDwKb/aCTVRFNt48PekgfIX2H3+o/MakoFbv6ZZfxKCfFq8m+DjS0ldU9YyjrqPhhye1rt0UBGmND2/p9Azr8jGvhIc6GX6Vf/gzWT165/gZzUfIEbDT0Qw3Wj0WBcMInG0ZKBJB/ZKJVUSeXf+VghLaMbIeCdUsuE2yNYtHuH7gVTEPNKLu8QFcxL4/yQdZ2lGYyUZwUF9pbKG3tBMuScvYRb++ebq9e7FDnGpj2HyJk0SuUFrqcsyMX/60R3kyu8F4PSGR+jlnIzYM9je/TudXGB2S/43UTYx3378qUY/wwBlXnVgnHlxK7f/kcu6PYwN1rThDrSuxtfICzDnxxM1jpiuWSVjnSBEjPbNMTG/i6dQyS95j6VJ+F4PNTnrj5C41lO74zB3ip7tMNrZeW9TjX4Plnm+5KiQxxbXrxWlBfB7bfTwSLTEXDWjfsxCQUs1v73PAAZWcuIg5jFR3VhedK1IDTTs8c/8XGHeyQSUWJjObuHhIQvWapykNzupK40bPTE7uHdl56ymsbOOey6rp6DnSQsolRYn1NCgs4Jhf8nP8/oL8mtQ/+dUzqMTNqKxQEFxn+DvU2+ylqoXcdjhqk3s0Xc/6PY+KfME9UlgwdIE+tqaIFvFPF67Cum2MNzYU4pd3n8VVKwTIQXboU3x408PdMl79D7Qubprc8JP68sClm2j0J6tJbgemMGsUE199ZY53Y/fct+rggqnJ15io7g+GinlPeN1v+qdHC4aFPpS3IUw1frLiT+pP1P5qDp4t59bmDyPXHy564xJys37jXizytpVTZ75NyFq77vE3zlwrjdQhFwYVVyaUFPp62wCkk+LgXFoUtdfeyBS3WamWhaPqDBCYxycvZ/q88EbkojyILF6xmzYOmuFI/vrrd014gbK1UZIIK6mG6JE9XAAEklBaIUdz3KzmSjIrYmWtliXEXPoNhtUC6YRtjLsH7qvdnjaNOzZi35hL6+JSxkpQXlakJN/qUx+Kx6oE/ew9m7z9i4x4yCLUTxPHB+781ezvuHpqm3uuNaWlK5OtnUU47ukGOQWKq41ZOMwvrRgatEThXr0nLk8PHjdZ26dzHqAnFGmhbc3ucrrQ7mgchpp/123SyBLUKTHYOr01cHjySJQTYLvvs2uYXuot3gmi5QC5Z9Jc0THC312gu0mCbfj6oqnlHUpklf2SOIy3pp+6wfoiI/P3os9doJsX6i3TTzFsknihj+irMGu5gvRrMuaIxuyqnihUI11X8gYpPOohhf3cYcnrgVJK+jIXcMjr9tmeNTw7vAdcDDI+DoCIgJ9o8XZ2LzTDTun3y8VfdLvw8ISVuc/5ELWTOS2//Fx/k3cuDbuTNvDqnikrUfUkrzgAuvTrYhvagQbKi9Mu5u8P1KDGGigD9O143x7JALJVy0jVN8D8xYTnL2oL/UhSFMLN5v8nUMMj7MOWE5qbU3IJF8eM3hDTnaMGe2aTNwNpnFpKjLi4AT+2WmtoBTh41WwApAefci1QAZR3nK9vMfyn/CNsSKjv/xv09HOpDRon/xh86U79MzjnvkUx2C2FohOM5Hk+62t1jcKmXj+i0PAZWbwIRIrjbx+adcPZUUL/3Y0p9zCqVynW/R/BAWMe5vZe2+laLCUpBN9jgJBIhbgewlVeYo6CPeCMnlE7+7i1CynNVFG9I8ZIe3H/FyRGBB0FNhPrHjYr0zr6R6FKBB20zqqzFtt/3s0Gs+W+iqyncvSoTwAa8T1r9TSplDnq8T+DYkzCOtgXYw+YbSXcPIXKU8qqoioIHwpO2HSzzybOdZ3/KV4pZIY2z10fuXVsFMOYMO85c5CMNx42T/oqVz+iM/8wwaQsBZVAXPwMe+9F+vYyivWe6SZere0xY8x/ip6wlbbXlh0Wfi6Zb1OY4B5sROpL+2ynDAZ/ZKOLKP9IaEmM2SvUNerv4YUkgPfO/DU6T2KknwYXv17GJNI+JUOb3fyXZNaOfIYeZf2Vb1YrnXUf5yOXU/nMK4aDChoZBHkXVYFoUmWVaMssUkhiGJbes/zApeWxmo84e7QTz+e+6I35+yaz9D+OctXF8UzGpgyWe3Ed9Eng7y8ukmROb6T7Dj4+UwHrJ3wVPrDQ3Y0aK927bnm9ZmZLHtyKc8nUiXH19EyPKLFhXaaXLfFwwCmy6rPG7FPnuoNJQAQwvGpJqvJYvFRIuxYFV1t2KZ7kna0UbuNSLI8jjAlkLN7LtzEJPwcF9jO3t+KgDsDUPUhiumziY9LKNWSQxECh6ThaX8f/W7gcrkfo7cnIgBauJJ4gFlAAL6j1HTpptGKMY4V0WbWK/GWtdN/mD4WXMp6rzHgJyHx3fzCRX3RIKt89aCJ2mk+oJW91Ib2G5KEYsMDa8hUU//4/JiItTA8XJ35Lp6fpTg9zM5NBYPWCvoJsRguF+C/ED2joRtLF5Fgrav0CTfEman2KoNIQUycqkR6skoTPeIINh4Oef7q3ebxCwGRtlcD+l/Az8KI+XV1zl2yhNiwVyidDXn0zbHUnDzh8vOZ7CVG6nDdfr9noPIkXMs9j1SptZAmAWy0lBx0Ev9QF1cZUqZBJ48NXbmoUXlMjfesOZBnDirWK/dtx9/jvIMS7FPmQnkXAhpLNizOp8ofWClNZ05PhikbIbyYbrsi+29dEXaLZkZ/vv0mlebRgAA=";
export const DEFAULT_FAVICON_DATA_URL = "data:image/webp;base64,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";

export const DEFAULT_LIGHT_THEME: ThemePalette = {
  primary: "#DC0E22",
  primaryStrong: "#B90C1D",
  primarySoft: "#FDEBED",
  secondary: "#3A98D5",
  accent: "#334051",
  background: "#F5F7FA",
  surface: "#FFFFFF",
  surfaceSoft: "#F8FAFC",
  surfaceRaised: "#FFFFFF",
  surfaceHover: "#FDEBED",
  text: "#172033",
  textSubtle: "#94A3B8",
  onPrimary: "#FFFFFF",
  muted: "#64748B",
  border: "#E2E8F0",
  sidebar: "#263446",
  sidebarText: "#DCE6F2",
  success: "#067647",
  warning: "#B54708",
  danger: "#B42318",
  info: "#175CD3",
};

export const DEFAULT_DARK_THEME: ThemePalette = {
  primary: "#F04458",
  primaryStrong: "#FB7185",
  primarySoft: "#3B1118",
  secondary: "#55B1E8",
  accent: "#B7C4D5",
  background: "#0D1420",
  surface: "#141E2D",
  surfaceSoft: "#101927",
  surfaceRaised: "#182537",
  surfaceHover: "#261B24",
  text: "#E8EEF6",
  textSubtle: "#7F91A8",
  onPrimary: "#FFFFFF",
  muted: "#98A7BA",
  border: "#2A384B",
  sidebar: "#08111D",
  sidebarText: "#DCE6F2",
  success: "#32D583",
  warning: "#FDB022",
  danger: "#F97066",
  info: "#53B1FD",
};

export type SystemSettings = {
  organizationId: string;
  organizationNameEn: string;
  organizationNameAr: string | null;
  systemNameEn: string;
  systemNameAr: string;
  timezone: string;
  defaultTheme: "LIGHT" | "DARK" | "SYSTEM";
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
  timeFormat: "12" | "24";
  showSeconds: boolean;
  defaultLocale: "en" | "ar";
  weekStartsOn: 0 | 1 | 6;
  density: "COMFORTABLE" | "COMPACT";
  lightTheme: ThemePalette;
  darkTheme: ThemePalette;
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function normalizePalette(value: unknown, fallback: ThemePalette): ThemePalette {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof ThemePalette>) {
    const candidate = source[key];
    if (typeof candidate === "string" && HEX.test(candidate)) result[key] = candidate.toUpperCase();
  }
  return result;
}

export async function getOrganizationSystemSettings(organizationId: string): Promise<SystemSettings> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { organizationSetting: true },
  });
  const s = organization.organizationSetting;
  return {
    organizationId,
    organizationNameEn: organization.nameEn,
    organizationNameAr: organization.nameAr,
    systemNameEn: s?.systemNameEn || organization.nameEn || "Family Lab",
    systemNameAr: s?.systemNameAr || organization.nameAr || "فاميلي لاب",
    timezone: organization.defaultTimezone || "Africa/Cairo",
    defaultTheme: s?.defaultTheme === "LIGHT" || s?.defaultTheme === "DARK" ? s.defaultTheme : "SYSTEM",
    dateFormat: s?.dateFormat === "MM/DD/YYYY" || s?.dateFormat === "YYYY-MM-DD" || s?.dateFormat === "DD MMM YYYY" ? s.dateFormat : "DD/MM/YYYY",
    timeFormat: s?.timeFormat === "24" ? "24" : "12",
    showSeconds: s?.showSeconds ?? false,
    defaultLocale: s?.defaultLocale === "ar" ? "ar" : "en",
    weekStartsOn: s?.weekStartsOn === 0 || s?.weekStartsOn === 6 ? s.weekStartsOn : 1,
    density: s?.density === "COMPACT" ? "COMPACT" : "COMFORTABLE",
    lightTheme: normalizePalette(s?.lightTheme, DEFAULT_LIGHT_THEME),
    darkTheme: normalizePalette(s?.darkTheme, DEFAULT_DARK_THEME),
    logoDataUrl: s?.logoDataUrl || DEFAULT_LOGO_DATA_URL,
    faviconDataUrl: s?.faviconDataUrl || DEFAULT_FAVICON_DATA_URL,
  };
}

function cssVars(p: ThemePalette) {
  return [
    ["--fl-primary", p.primary],
    ["--fl-primary-strong", p.primaryStrong],
    ["--fl-primary-soft", p.primarySoft],
    ["--fl-secondary", p.secondary],
    ["--fl-accent", p.accent],
    ["--fl-bg", p.background],
    ["--fl-surface", p.surface],
    ["--fl-surface-soft", p.surfaceSoft],
    ["--fl-surface-raised", p.surfaceRaised],
    ["--fl-surface-hover", p.surfaceHover],
    ["--fl-text", p.text],
    ["--fl-text-subtle", p.textSubtle],
    ["--fl-on-primary", p.onPrimary],
    ["--fl-muted", p.muted],
    ["--fl-border", p.border],
    ["--fl-navy", p.sidebar],
    ["--fl-sidebar-text", p.sidebarText],
    ["--fl-success", p.success],
    ["--fl-warning", p.warning],
    ["--fl-danger", p.danger],
    ["--fl-info", p.info],
    ["--fl-focus-ring", `color-mix(in srgb, ${p.primary} 18%, transparent)`],
    ["--fl-overlay", `color-mix(in srgb, ${p.text} 58%, transparent)`],
    ["--fl-success-soft", `color-mix(in srgb, ${p.success} 12%, ${p.surface})`],
    ["--fl-warning-soft", `color-mix(in srgb, ${p.warning} 12%, ${p.surface})`],
    ["--fl-danger-soft", `color-mix(in srgb, ${p.danger} 12%, ${p.surface})`],
    ["--fl-accent-soft", `color-mix(in srgb, ${p.accent} 12%, ${p.surface})`],
    ["--fl-info-soft", `color-mix(in srgb, ${p.info} 12%, ${p.surface})`],
  ].map(([key, value]) => `${key}:${value}`).join(";");
}

export function buildThemeCss(settings: Pick<SystemSettings, "lightTheme" | "darkTheme">) {
  return `:root{${cssVars(settings.lightTheme)}}html[data-theme="dark"]{${cssVars(settings.darkTheme)}}`;
}

export function validateImageDataUrl(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (!/^data:image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(value)) return undefined;
  if (value.length > 1_400_000) return undefined;
  return value;
}
