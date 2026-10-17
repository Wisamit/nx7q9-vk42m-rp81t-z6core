import { parseSystemLocalDateTime } from "./system-date-time.ts";

/**
 * Resolve a wall-clock date/time against the explicitly selected operating branch.
 * Reject DST gaps and folds instead of guessing a UTC instant from the server clock.
 * An already-qualified ISO instant remains an instant for existing integrations.
 */
export function parseBranchExpectedInstant(value: string, timeZone: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const explicit = new Date(value);
    return Number.isFinite(explicit.getTime()) ? explicit : null;
  }

  const { date, time } = parseSystemLocalDateTime(value);
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (year < 100 || year > 9999) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch { return null; }

  const wallMillis = Date.UTC(year, month - 1, day, hour, minute);
  let matched: Date | null = null;
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(wallMillis - offsetMinutes * 60000);
    const parts = formatter.formatToParts(candidate);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
    const local = part("year").padStart(4, "0") + "-" + part("month") + "-" + part("day") +
      "T" + part("hour") + ":" + part("minute");
    if (local !== value) continue;
    if (matched) return null; // Ambiguous repeated wall-clock time during a DST fold.
    matched = candidate;
  }
  return matched;
}
