"use client";

import { createContext, useContext, useMemo } from "react";
import type { UiLocale } from "@/lib/ui-i18n";

type UiLocaleContextValue = {
  locale: UiLocale;
  dir: "rtl" | "ltr";
  t: <T>(en: T, ar: T) => T;
};

const UiLocaleContext = createContext<UiLocaleContextValue | null>(null);

export function UiLocaleProvider({ locale, children }: { locale: UiLocale; children: React.ReactNode }) {
  const value = useMemo<UiLocaleContextValue>(() => ({
    locale,
    dir: locale === "ar" ? "rtl" : "ltr",
    t: <T,>(en: T, ar: T) => locale === "ar" ? ar : en,
  }), [locale]);

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale() {
  const context = useContext(UiLocaleContext);
  if (!context) throw new Error("useUiLocale must be used within UiLocaleProvider");
  return context;
}
