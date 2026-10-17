import { normalizeSystemDateFormat } from "./system-date.ts";

/** The HTML data attributes are presentation preferences, never clinical truth. */
export const DEFAULT_ROOT_DATE_PREFERENCES = "DD/MM/YYYY|UTC|24|false";
export const ROOT_DATE_ATTRIBUTES = [
  "data-date-format", "data-timezone", "data-time-format", "data-show-seconds",
] as const;

export function readRootDatePreferences(): string {
  const root = document.documentElement.dataset;
  return [
    normalizeSystemDateFormat(root.dateFormat),
    root.timezone || "UTC",
    root.timeFormat === "12" ? "12" : "24",
    root.showSeconds === "true" ? "true" : "false",
  ].join("|");
}

/** Updates all mounted date views on settings/navigation changes. */
export function subscribeRootDatePreferences(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [...ROOT_DATE_ATTRIBUTES],
  });
  return () => observer.disconnect();
}

/** Server rendering must use a stable snapshot so hydration is deterministic. */
export function serializedRootDatePreferences(input: {
  dateFormat: string;
  timezone: string;
  timeFormat: "12" | "24";
  showSeconds: boolean;
}): string {
  return [normalizeSystemDateFormat(input.dateFormat), input.timezone,
    input.timeFormat, input.showSeconds ? "true" : "false"].join("|");
}
