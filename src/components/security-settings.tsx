"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useState } from "react";
import { SystemIcon } from "@/components/system-icon";

type Enrollment = {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return reject(new Error("invalid"));
    if (file.size > 1024 * 1024) return reject(new Error("large"));
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid"));
    reader.onerror = () => reject(new Error("invalid"));
    reader.readAsDataURL(file);
  });
}

export function SecuritySettings({
  locale,
  avatarDataUrl,
  displayName,
  mfaEnabled,
  mfaConfirmedAt,
}: {
  locale: "ar" | "en";
  avatarDataUrl: string | null;
  displayName: string;
  mfaEnabled: boolean;
  mfaConfirmedAt: string | null;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [avatar, setAvatar] = useState(avatarDataUrl);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const response = await fetch("/api/security/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarDataUrl: dataUrl }),
      });
      if (!response.ok) throw new Error("save");
      setAvatar(dataUrl);
      setMessage(tr("Profile picture updated.", "تم تحديث الصورة الشخصية."));
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error && error.message === "large"
        ? tr("Image must be 1 MB or smaller.", "يجب ألا يتجاوز حجم الصورة 1 ميغابايت.")
        : tr("Use PNG, JPEG or WEBP.", "استخدم صورة PNG أو JPEG أو WEBP."));
    }
    setBusy(false);
  }

  async function removeAvatar() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/security/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarDataUrl: null }),
    });
    if (response.ok) {
      setAvatar(null);
      window.location.reload();
    } else setMessage(tr("Unable to remove profile picture.", "تعذر إزالة الصورة الشخصية."));
    setBusy(false);
  }

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRecoveryCodes([]);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/enroll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) setEnrollment(body);
    else setMessage(body.error === "invalid_password"
      ? tr("Current password is incorrect.", "كلمة المرور الحالية غير صحيحة.")
      : tr("Unable to start MFA enrollment.", "تعذر بدء إعداد المصادقة متعددة العوامل."));
    setBusy(false);
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.get("code") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setRecoveryCodes(body.recoveryCodes || []);
      setEnrollment(null);
      setMessage(tr(
        "MFA enabled. Save the recovery codes below now; they are shown only once.",
        "تم تفعيل المصادقة متعددة العوامل. احفظ رموز الاسترداد الآن لأنها تظهر مرة واحدة فقط."
      ));
    } else setMessage(tr("Invalid authenticator code.", "رمز تطبيق المصادقة غير صحيح."));
    setBusy(false);
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm(tr(
      "Disable multi-factor authentication for this staff account? Other active sessions will be revoked.",
      "تعطيل المصادقة متعددة العوامل لهذا الحساب؟ سيتم إلغاء الجلسات النشطة الأخرى."
    ))) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/security/mfa/disable", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), code: form.get("code") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return window.location.reload();
    setMessage(body.error === "invalid_password"
      ? tr("Current password is incorrect.", "كلمة المرور الحالية غير صحيحة.")
      : tr("MFA code is invalid.", "رمز المصادقة غير صحيح."));
    setBusy(false);
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <div className="section-title-row">
        <div><p className="eyebrow">{tr("Profile", "الملف الشخصي")}</p><h2>{tr("Profile Picture", "الصورة الشخصية")}</h2></div>
      </div>
      <div className="profile-avatar-settings">
        <div className="profile-avatar-large">
          {avatar ? <Image src={avatar} alt={displayName} width={86} height={86} unoptimized /> : <SystemIcon name="users" size={34} />}
        </div>
        <div>
          <strong>{displayName}</strong>
          <p className="muted">{tr("PNG, JPEG or WEBP. Maximum 1 MB.", "PNG أو JPEG أو WEBP. الحد الأقصى 1 ميغابايت.")}</p>
          <div className="header-actions">
            <label className="secondary-button file-button">{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Choose image", "اختيار صورة")}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void saveAvatar(e)} /></label>
            {avatar && <button type="button" className="secondary-button" disabled={busy} onClick={() => void removeAvatar()}>{tr("Remove image", "إزالة الصورة")}</button>}
          </div>
        </div>
      </div>
    </article>

    <article className="detail-card">
      <div className="section-title-row">
        <div><p className="eyebrow">{tr("Staff Account", "حساب الموظف")}</p><h2>{tr("Multi-Factor Authentication", "المصادقة متعددة العوامل")}</h2></div>
        <span className={"status-badge " + (mfaEnabled ? "status-active" : "status-draft")}>{mfaEnabled ? tr("ENABLED", "مفعلة") : tr("NOT ENABLED", "غير مفعلة")}</span>
      </div>
      <p className="muted">{tr(
        "TOTP MFA works with standard authenticator apps. The MFA secret is encrypted at rest.",
        "تعمل المصادقة TOTP مع تطبيقات المصادقة القياسية، ويتم تشفير المفتاح السري أثناء التخزين."
      )}</p>
      {mfaEnabled && mfaConfirmedAt && <p className="muted">{tr("Confirmed", "تم التأكيد")}: {new Date(mfaConfirmedAt).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB")}</p>}

      {!mfaEnabled && !enrollment && <form className="form-stack" onSubmit={beginEnrollment}>
        <label>{tr("Current password", "كلمة المرور الحالية")}<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <button className="primary-button" disabled={busy}>{busy ? tr("Starting…", "جارٍ البدء…") : tr("Set up MFA", "إعداد المصادقة متعددة العوامل")}</button>
      </form>}

      {!mfaEnabled && enrollment && <>
        <div className="mfa-enrollment">
          <Image src={enrollment.qrDataUrl} alt={tr("Authenticator QR code", "رمز QR لتطبيق المصادقة")} width={190} height={190} unoptimized />
          <div>
            <strong>{tr("Scan this QR code", "امسح رمز QR")}</strong>
            <p className="muted">{tr("Or enter this secret manually in your authenticator app:", "أو أدخل هذا المفتاح يدويًا في تطبيق المصادقة:")}</p>
            <code className="security-secret">{enrollment.secret}</code>
          </div>
        </div>
        <form className="form-stack" onSubmit={confirmEnrollment}>
          <label>{tr("6-digit authenticator code", "رمز المصادقة المكون من 6 أرقام")}<input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} /></label>
          <button className="primary-button" disabled={busy}>{busy ? tr("Confirming…", "جارٍ التأكيد…") : tr("Confirm and enable MFA", "تأكيد وتفعيل المصادقة")}</button>
        </form>
      </>}

      {mfaEnabled && <form className="form-stack" onSubmit={disableMfa}>
        <label>{tr("Current password", "كلمة المرور الحالية")}<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <label>{tr("Authenticator or recovery code", "رمز المصادقة أو رمز الاسترداد")}<input name="code" required autoComplete="one-time-code" /></label>
        <button className="danger-button" disabled={busy}>{busy ? tr("Disabling…", "جارٍ التعطيل…") : tr("Disable MFA", "تعطيل المصادقة")}</button>
      </form>}
      {message && <p className="form-success">{message}</p>}
    </article>

    <article className="detail-card">
      <p className="eyebrow">{tr("Recovery", "الاسترداد")}</p>
      <h2>{tr("Recovery Codes", "رموز الاسترداد")}</h2>
      {recoveryCodes.length ? <>
        <p className="muted">{tr(
          "Store these codes securely. Each code can be used once if the authenticator device is unavailable.",
          "احفظ هذه الرموز في مكان آمن. يمكن استخدام كل رمز مرة واحدة إذا تعذر الوصول إلى جهاز المصادقة."
        )}</p>
        <div className="recovery-code-grid">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div>
      </> : <p className="muted">{mfaEnabled
        ? tr("Recovery codes were issued when MFA was enabled. They are not displayed again.", "تم إصدار رموز الاسترداد عند تفعيل المصادقة ولن يتم عرضها مرة أخرى.")
        : tr("Recovery codes will be generated after MFA is confirmed.", "سيتم إنشاء رموز الاسترداد بعد تأكيد المصادقة.")}</p>}
    </article>
  </div>;
}
