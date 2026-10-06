"use client";

import { useEffect, useState } from "react";
import { SystemIcon } from "@/components/system-icon";

type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";

function preferred(defaultTheme: ThemeMode) {
  if (defaultTheme === "LIGHT") return "light";
  if (defaultTheme === "DARK") return "dark";
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ defaultTheme, labelLight, labelDark }: { defaultTheme: ThemeMode; labelLight: string; labelDark: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("family-lab-theme");
    const next = saved === "light" || saved === "dark" ? saved : preferred(defaultTheme);
    document.documentElement.dataset.theme = next;
    const timer = window.setTimeout(() => setTheme(next), 0);
    return () => window.clearTimeout(timer);
  }, [defaultTheme]);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("family-lab-theme", next);
  }

  return <button className="system-theme-toggle" type="button" onClick={toggle} title={theme === "dark" ? labelLight : labelDark} aria-label={theme === "dark" ? labelLight : labelDark}>
    <SystemIcon name={theme === "dark" ? "sun" : "moon"} size={17} />
  </button>;
}
