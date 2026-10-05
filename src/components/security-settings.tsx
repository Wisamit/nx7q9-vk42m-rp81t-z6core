"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

type Enrollment = {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
};

export function SecuritySettings({ mfaEnabled, mfaConfirmedAt }: { mfaEnabled: boolean; mfaConfirmedAt: string | null }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRecoveryCodes([]);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) setEnrollment(body);
    else setMessage(body.error === "invalid_password" ? "Current password is incorrect." : "Unable to start MFA enrollment.");
    setBusy(false);
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.get("code") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setRecoveryCodes(body.recoveryCodes || []);
      setEnrollment(null);
      setMessage("MFA enabled. Save the recovery codes below now; they are shown only once.");
    } else setMessage("Invalid authenticator code.");
    setBusy(false);
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm("Disable multi-factor authentication for this staff account? Other active sessions will be revoked.")) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        code: form.get("code"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      window.location.reload();
      return;
    }
    setMessage(body.error === "invalid_password" ? "Current password is incorrect." : "MFA code is invalid.");
    setBusy(false);
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <div className="section-title-row">
        <div><p className="eyebrow">Staff Account</p><h2>Multi-Factor Authentication</h2></div>
        <span className={"status-badge " + (mfaEnabled ? "status-active" : "status-draft")}>{mfaEnabled ? "ENABLED" : "NOT ENABLED"}</span>
      </div>
      <p className="muted">TOTP MFA works with standard authenticator apps. The MFA secret is encrypted at rest using the server encryption key.</p>
      {mfaEnabled && mfaConfirmedAt && <p className="muted">Confirmed: {new Date(mfaConfirmedAt).toLocaleString()}</p>}

      {!mfaEnabled && !enrollment && <form className="form-stack" onSubmit={beginEnrollment}>
        <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <button className="primary-button" disabled={busy}>{busy ? "Starting…" : "Set up MFA"}</button>
      </form>}

      {!mfaEnabled && enrollment && <>
        <div className="mfa-enrollment">
          <Image src={enrollment.qrDataUrl} alt="Authenticator QR code" width={190} height={190} unoptimized />
          <div>
            <strong>Scan this QR code</strong>
            <p className="muted">Or enter this secret manually in your authenticator app:</p>
            <code className="security-secret">{enrollment.secret}</code>
          </div>
        </div>
        <form className="form-stack" onSubmit={confirmEnrollment}>
          <label>6-digit authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} /></label>
          <button className="primary-button" disabled={busy}>{busy ? "Confirming…" : "Confirm and enable MFA"}</button>
        </form>
      </>}

      {mfaEnabled && <form className="form-stack" onSubmit={disableMfa}>
        <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <label>Authenticator or recovery code<input name="code" required autoComplete="one-time-code" /></label>
        <button className="danger-button" disabled={busy}>{busy ? "Disabling…" : "Disable MFA"}</button>
      </form>}
      {message && <p className="form-success">{message}</p>}
    </article>

    <article className="detail-card">
      <p className="eyebrow">Recovery</p>
      <h2>Recovery Codes</h2>
      {recoveryCodes.length ? <>
        <p className="muted">Store these codes securely. Each code can be used once if the authenticator device is unavailable.</p>
        <div className="recovery-code-grid">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div>
      </> : <p className="muted">{mfaEnabled ? "Recovery codes were issued when MFA was enabled. They are not displayed again." : "Recovery codes will be generated after MFA is confirmed."}</p>}
    </article>
  </div>;
}
