import { parseSystemDateInput } from "./system-date";

/** A local wall-clock datetime, independent of machine/server timezone. */
export function parseSystemLocalDateTime(raw: string | null | undefined) {
  const match = (raw || "").match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match || !parseSystemDateInput(match[1], "YYYY-MM-DD")) return { date: "", time: "" };
  return { date: match[1], time: match[2] + ":" + match[3] };
}

export function composeSystemLocalDateTime(date: string, time: string): string {
  if (!parseSystemDateInput(date, "YYYY-MM-DD") ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  return date + "T" + time;
}
