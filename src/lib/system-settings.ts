import { prisma } from "@/lib/db";

export type ThemePalette = {
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  sidebar: string;
  sidebarText: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

export const DEFAULT_LIGHT_THEME: ThemePalette = {
  primary: "#DC0E22",
  primaryStrong: "#B90C1D",
  primarySoft: "#FDEBED",
  secondary: "#3A98D5",
  accent: "#334051",
  background: "#F5F7FA",
  surface: "#FFFFFF",
  text: "#172033",
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
  text: "#E8EEF6",
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
  developerCredit: string;
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
    timezone: organization.defaultTimezone || "Asia/Dubai",
    defaultTheme: s?.defaultTheme === "LIGHT" || s?.defaultTheme === "DARK" ? s.defaultTheme : "SYSTEM",
    dateFormat: s?.dateFormat === "MM/DD/YYYY" || s?.dateFormat === "YYYY-MM-DD" || s?.dateFormat === "DD MMM YYYY" ? s.dateFormat : "DD/MM/YYYY",
    timeFormat: s?.timeFormat === "24" ? "24" : "12",
    showSeconds: s?.showSeconds ?? false,
    defaultLocale: s?.defaultLocale === "ar" ? "ar" : "en",
    weekStartsOn: s?.weekStartsOn === 0 || s?.weekStartsOn === 6 ? s.weekStartsOn : 1,
    density: s?.density === "COMPACT" ? "COMPACT" : "COMFORTABLE",
    lightTheme: normalizePalette(s?.lightTheme, DEFAULT_LIGHT_THEME),
    darkTheme: normalizePalette(s?.darkTheme, DEFAULT_DARK_THEME),
    logoDataUrl: s?.logoDataUrl || null,
    faviconDataUrl: s?.faviconDataUrl || null,
    developerCredit: s?.developerCredit || "Wisam",
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
    ["--fl-text", p.text],
    ["--fl-muted", p.muted],
    ["--fl-border", p.border],
    ["--fl-navy", p.sidebar],
    ["--fl-sidebar-text", p.sidebarText],
    ["--fl-success", p.success],
    ["--fl-warning", p.warning],
    ["--fl-danger", p.danger],
    ["--fl-info", p.info],
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
