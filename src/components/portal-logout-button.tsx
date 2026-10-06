"use client";

import { useRouter } from "next/navigation";

export function PortalLogoutButton({ locale }: { locale: "ar" | "en" }) {
  const router = useRouter();
  const label = locale === "ar" ? "تسجيل الخروج" : "Sign out";
  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
    router.refresh();
  }
  return <button className="secondary-button" type="button" onClick={() => void logout()}>{label}</button>;
}
