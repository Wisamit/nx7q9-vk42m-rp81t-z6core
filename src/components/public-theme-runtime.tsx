"use client";

import { useEffect } from "react";

type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";

function resolveTheme(defaultTheme: ThemeMode) {
  const saved = window.localStorage.getItem("family-lab-theme");
  if (saved === "light" || saved === "dark") return saved;
  if (defaultTheme === "LIGHT") return "light";
  if (defaultTheme === "DARK") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function PublicThemeRuntime({
  defaultTheme,
  faviconDataUrl,
}: {
  defaultTheme: ThemeMode;
  faviconDataUrl: string | null;
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(defaultTheme);
    if (faviconDataUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = faviconDataUrl;
    }
  }, [defaultTheme, faviconDataUrl]);

  return null;
}
