"use client";

import { useEffect, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { useSyncExternalStore } from "react";
import { normalizeSystemDateFormat } from "@/lib/system-date";
import { readRootDatePreferences, serializedRootDatePreferences, subscribeRootDatePreferences } from "@/lib/root-date-preferences";

type Props = {
  locale: "ar" | "en";
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
  timeFormat: "12" | "24";
  showSeconds: boolean;
};

function formatDate(value: Date, locale: "ar" | "en", timezone: string, format: Props["dateFormat"]) {
  const numeric = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => numeric.find(x => x.type === type)?.value || "";
  if (format === "MM/DD/YYYY") return `${part("month")}/${part("day")}/${part("year")}`;
  if (format === "YYYY-MM-DD") return `${part("year")}-${part("month")}-${part("day")}`;
  if (format === "DD MMM YYYY") {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
      timeZone: timezone, day: "2-digit", month: "short", year: "numeric",
    }).format(value);
  }
  return `${part("day")}/${part("month")}/${part("year")}`;
}

export function SystemClock({ locale, timezone, dateFormat, timeFormat, showSeconds }: Props) {
  const settings = useSyncExternalStore(
    subscribeRootDatePreferences,
    readRootDatePreferences,
    () => serializedRootDatePreferences({ dateFormat, timezone, timeFormat, showSeconds }),
  ).split("|");
  const liveDateFormat = normalizeSystemDateFormat(settings[0]);
  const liveTimeZone = settings[1] || timezone;
  const liveTimeFormat = settings[2] === "12" ? "12" : "24";
  const liveShowSeconds = settings[3] === "true";
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), liveShowSeconds ? 1000 : 30000);
    return () => window.clearInterval(interval);
  }, [liveShowSeconds]);

  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-US", {
    timeZone: liveTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: liveShowSeconds ? "2-digit" : undefined,
    hour12: liveTimeFormat === "12",
  }).format(now);

  return <div className="system-clock" title={liveTimeZone}>
    <SystemIcon name="clock" size={16} />
    <div>
      <strong>{time}</strong>
      <small>{formatDate(now, locale, liveTimeZone, liveDateFormat)}</small>
    </div>
  </div>;
}
