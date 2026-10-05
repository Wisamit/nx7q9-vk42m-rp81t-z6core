"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalChangePasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    setMessage("");
    const response = await fetch("/api/portal/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error === "password_too_short" ? "Use at least 12 characters." : body.error || "Could not change password.");
      return;
    }
    router.replace("/portal");
    router.refresh();
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">New password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
    <label className="form-span">Confirm password<input name="confirm" type="password" minLength={12} autoComplete="new-password" required /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
    {message && <p className="form-error form-span">{message}</p>}
  </form>;
}
