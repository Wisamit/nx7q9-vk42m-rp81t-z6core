"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalLoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: form.get("login"),
        password: form.get("password"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error === "portal_account_temporarily_locked"
        ? "Account temporarily locked after repeated failed attempts."
        : "Invalid portal credentials.");
      return;
    }
    router.replace(body.mustChangePassword ? "/portal/change-password" : "/portal");
    router.refresh();
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label className="form-span">Email or phone<input name="login" autoComplete="username" required /></label>
    <label className="form-span">Password<input name="password" type="password" autoComplete="current-password" required /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    {message && <p className="form-error form-span">{message}</p>}
  </form>;
}
