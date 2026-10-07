export type ReportLanguageMode = "BILINGUAL" | "ENGLISH" | "ARABIC";
export type ReportLocale = "ar" | "en";

export function effectiveReportLocale(mode: ReportLanguageMode, viewerLocale: ReportLocale): ReportLocale {
  if (mode === "ARABIC") return "ar";
  if (mode === "ENGLISH") return "en";
  return viewerLocale;
}

export function reportShowsEnglish(mode: ReportLanguageMode) {
  return mode !== "ARABIC";
}

export function reportShowsArabic(mode: ReportLanguageMode) {
  return mode !== "ENGLISH";
}

export function localizedReportText(
  mode: ReportLanguageMode,
  viewerLocale: ReportLocale,
  value: { en?: string | null; ar?: string | null },
) {
  const locale = effectiveReportLocale(mode, viewerLocale);
  if (locale === "ar") return value.ar || value.en || "";
  return value.en || value.ar || "";
}

export function secondaryReportText(
  mode: ReportLanguageMode,
  viewerLocale: ReportLocale,
  value: { en?: string | null; ar?: string | null },
) {
  if (mode !== "BILINGUAL") return null;
  const locale = effectiveReportLocale(mode, viewerLocale);
  return locale === "ar"
    ? value.en || null
    : value.ar || null;
}
