/**
 * Organization-facing calendar dates. These are dates without a time zone.
 * The API boundary always receives the canonical YYYY-MM-DD value.
 * Never use Date.parse on a locale-formatted date: 05/11 is ambiguous.
 */
export type SystemDateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";

export function normalizeSystemDateFormat(value: string | null | undefined): SystemDateFormat {
  return value === "MM/DD/YYYY" || value === "YYYY-MM-DD" || value === "DD MMM YYYY"
    ? value : "DD/MM/YYYY";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function normalizeDigits(value: string) {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
}

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // setUTCFullYear avoids Date.UTC treating years 00-99 as 1900-1999.
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return String(year).padStart(4, "0") + "-" + pad(month) + "-" + pad(day);
}

/** Strict conversion only: invalid calendar days and ambiguous formats are rejected. */
export function parseSystemDateInput(value: string, format: SystemDateFormat): string | null {
  const text = normalizeDigits(value.trim());
  let m: RegExpMatchArray | null;
  if (format === "YYYY-MM-DD") {
    m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? toIso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  if (format === "DD MMM YYYY") {
    m = text.match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/);
    const month = m ? MONTHS.findIndex(item => item.toLowerCase() === m![2].toLowerCase()) + 1 : 0;
    return m ? toIso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return format === "MM/DD/YYYY"
    ? toIso(Number(m[3]), Number(m[1]), Number(m[2]))
    : toIso(Number(m[3]), Number(m[2]), Number(m[1]));
}

export function formatSystemDate(isoDate: string, format: SystemDateFormat): string {
  const iso = parseSystemDateInput(isoDate, "YYYY-MM-DD");
  if (!iso) return "";
  const year = iso.slice(0, 4), month = Number(iso.slice(5, 7)), day = iso.slice(8, 10);
  if (format === "YYYY-MM-DD") return iso;
  if (format === "MM/DD/YYYY") return pad(month) + "/" + day + "/" + year;
  if (format === "DD MMM YYYY") return day + " " + MONTHS[month - 1] + " " + year;
  return day + "/" + pad(month) + "/" + year;
}

export function dateInputExample(format: SystemDateFormat): string {
  return format === "DD MMM YYYY" ? "05 Nov 2026"
    : format === "MM/DD/YYYY" ? "11/05/2026"
    : format === "YYYY-MM-DD" ? "2026-11-05" : "05/11/2026";
}
