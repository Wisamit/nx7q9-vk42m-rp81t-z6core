import { formatSystemDate, normalizeSystemDateFormat, parseSystemDateInput, type SystemDateFormat } from "./system-date.ts";

export type SystemDateDisplayPreferences = {
  dateFormat: SystemDateFormat;
  timeFormat: "12" | "24";
  timeZone: string;
  showSeconds: boolean;
};

/** Date-only values must never shift to a neighboring day from timezone conversion. */
export function formatCalendarDisplay(isoDate: string, dateFormat: SystemDateFormat): string {
  const canonical = parseSystemDateInput(isoDate, "YYYY-MM-DD");
  return canonical ? formatSystemDate(canonical, dateFormat) : "—";
}

/** Instant timestamps must be rendered in the configured organization timezone. */
export function formatInstantDisplay(value: string, preferences: SystemDateDisplayPreferences): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "—";
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "—";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: preferences.timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      ...(preferences.showSeconds ? { second: "2-digit" as const } : {}),
      hourCycle: preferences.timeFormat === "12" ? "h12" : "h23",
    }).formatToParts(time);
  } catch {
    return "—";
  }
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)?.value || "";
  const day = part("day"), month = part("month"), year = part("year");
  const calendar = formatSystemDate(year + "-" + month + "-" + day, normalizeSystemDateFormat(preferences.dateFormat));
  if (!calendar) return "—";
  const clock = part("hour") + ":" + part("minute") +
    (preferences.showSeconds ? ":" + part("second") : "") +
    (preferences.timeFormat === "12" ? " " + part("dayPeriod") : "");
  return calendar + " " + clock;
}


/** Current-day/event-day rendering in an explicit timezone (not UTC day slicing). */
export function formatInstantDateDisplay(value: string, preferences: SystemDateDisplayPreferences): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: preferences.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(parsed);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
    return formatCalendarDisplay(part("year") + "-" + part("month") + "-" + part("day"), preferences.dateFormat);
  } catch {
    return "—";
  }
}
