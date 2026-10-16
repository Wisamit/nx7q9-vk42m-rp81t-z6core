"use client";

import { useSyncExternalStore } from "react";
import { formatCalendarDisplay, formatInstantDisplay } from "@/lib/system-date-display";
import { normalizeSystemDateFormat } from "@/lib/system-date";

type Props = {
  value: string;
  kind?: "calendar" | "instant";
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
  const display = kind === "calendar"
    ? formatCalendarDisplay(value, dateFormat)
    : formatInstantDisplay(value, {
      dateFormat,
      timeFormat: settings[2] === "12" ? "12" : "24",
      timeZone: zone,
      showSeconds: settings[3] === "true",
    });
  return <time
    className="system-date-text"
    dir="ltr"
    dateTime={value}
    title={kind === "instant" ? value + " · " + zone : value}
  >{display}</time>;
}
