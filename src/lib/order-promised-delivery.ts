import { localDateTimeToUtc } from "./order-questions.ts";

export type PromisedReportDeliverySnapshot = {
  promisedReportDeliveryAtUtc: Date;
  promisedReportDeliveryLocal: string;
  promisedReportDeliveryTimezone: string;
};
export type DeliveryPromiseParseResult =
  | { ok: true; snapshot: PromisedReportDeliverySnapshot | null }
  | { ok: false; error: "invalid_promised_report_delivery" | "invalid_ordering_branch_timezone" |
      "promised_report_delivery_in_past" | "ambiguous_promised_report_delivery" };

function formatLocalDateTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value || "";
  return part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");
}

/**
 * Registration-only promise, independently entered by staff. A promised
 * delivery is NOT a laboratory TAT deadline and NEVER triggers a release.
 * Reject DST folds/gaps rather than silently assigning the wrong instant.
 */
export function parsePromisedReportDelivery(
  input: unknown, timeZone: string, now: Date = new Date(),
): DeliveryPromiseParseResult {
  if (input === undefined || input === null || input === "") {
    return { ok: true, snapshot: null };
  }
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) {
    return { ok: false, error: "invalid_promised_report_delivery" };
  }
  try {
    // An invalid / unconfigured IANA zone is an operational configuration
    // error; do not silently fall back to the server's timezone.
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(now);
  } catch {
    return { ok: false, error: "invalid_ordering_branch_timezone" };
  }
  const utc = localDateTimeToUtc(input, timeZone);
  if (!utc || !Number.isFinite(utc.getTime()) || formatLocalDateTime(utc, timeZone) !== input) {
    return { ok: false, error: "invalid_promised_report_delivery" };
  }
  // Minute-precision promise must be in the future at the point of entry.
  if (utc.getTime() <= now.getTime()) {
    return { ok: false, error: "promised_report_delivery_in_past" };
  }
  // Check for a second UTC instant that has the identical local clock time.
  // In DST fall-back, two instants map to the same clock time. An explicit
  // offset is required before either can be accepted, so reject both.
  for (let minutes = -180; minutes <= 180; minutes += 15) {
    if (minutes === 0) continue;
    const alternative = new Date(utc.getTime() + minutes * 60_000);
    if (formatLocalDateTime(alternative, timeZone) === input) {
      return { ok: false, error: "ambiguous_promised_report_delivery" };
    }
  }
  return { ok: true, snapshot: {
    promisedReportDeliveryAtUtc: utc,
    promisedReportDeliveryLocal: input,
    promisedReportDeliveryTimezone: timeZone,
  } };
}
