"use client";

import { useSyncExternalStore } from "react";
import { formatCalendarDisplay, formatInstantDisplay, formatInstantDateDisplay } from "@/lib/system-date-display";
import { normalizeSystemDateFormat } from "@/lib/system-date";

type Props = {
  value: string;
  kind?: "calendar" | "instant" | "instant-date";
  timeZone?: string;
};

const subscribe = () => () => {};
const currentSettings = () => {
  const root = document.documentElement;
  return [
    root.dataset.dateFormat || "DD/MM/YYYY",
    root.dataset.timezone || "UTC",
    root.dataset.timeFormat || "24",
    root.dataset.showSeconds || "false",
  ].join("|");
};
const initialSettings = () => "DD/MM/YYYY|UTC|24|false";

/** Preserve original ISO in datetime/title while displaying configured date and timezone. */
export function SystemDateText({ value, kind = "instant", timeZone }: Props) {
  const settings = useSyncExternalStore(subscribe, currentSettings, initialSettings).split("|");
  const dateFormat = normalizeSystemDateFormat(settings[0]);
  const zone = timeZone || settings[1] || "UTC";
  const preferences = {
    dateFormat,
    timeFormat: settings[2] === "12" ? "12" as const : "24" as const,
    timeZone: zone,
    showSeconds: settings[3] === "true",
  };
  const display = kind === "calendar"
    ? formatCalendarDisplay(value, dateFormat)
    : kind === "instant-date"
    ? formatInstantDateDisplay(value, preferences)
    : formatInstantDisplay(value, {
      ...preferences,
    });
  return <time
    className="system-date-text"
    dir="ltr"
    dateTime={value}
    title={kind === "calendar" ? value : value + " · " + zone}
  >{display}</time>;
}
