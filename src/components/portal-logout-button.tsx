"use client";

import { useRouter } from "next/navigation";

export function PortalLogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
    router.refresh();
  }
  return <button className="secondary-button" type="button" onClick={() => void logout()}>Sign out</button>;
}
