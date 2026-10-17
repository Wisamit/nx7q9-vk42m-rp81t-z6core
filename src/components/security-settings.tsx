"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

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
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [avatarRemovalOpen, setAvatarRemovalOpen] = useState(false);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const newPassword = String(values.get("newPassword") || "");
    const confirmPassword = String(values.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setPasswordMessage(tr("New passwords do not match.", "كلمتا المرور الجديدتان غير متطابقتين."));
      return;
    }
    setPasswordBusy(true); setPasswordMessage("");
    try {
      const response = await fetch("/api/security/profile/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: values.get("currentPassword"),
          newPassword, confirmPassword,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        form.reset();
        window.location.assign("/login?passwordChanged=1");
        return;
      }
      const errors: Record<string, [string,string]> = {
        current_password_invalid: ["Current password incorrect.", "كلمة المرور الحالية غير صحيحة."],
        new_password_must_differ: ["New password must differ from current password.", "يجب أن تختلف كلمة المرور الجديدة عن الحالية."],
        password_policy_failed: ["Use at least 12 characters and at most 72 UTF-8 bytes.", "استخدم 12 محرفًا على الأقل وبحد أقصى 72 بايت UTF-8."],
        password_confirmation_mismatch: ["New passwords do not match.", "كلمتا المرور الجديدتان غير متطابقتين."],
        rate_limited: ["Too many requests. Try later.", "محاولات كثيرة، حاول لاحقًا."],
        session_expired: ["Session expired. Sign in again.", "انتهت الجلسة، سجّل الدخول مجددًا."],
      };
      setPasswordMessage(errors[body.error ?? ""]?.[locale === "ar" ? 1 : 0] ||
        tr("Password change failed. Please retry safely.", "فشل تغيير كلمة المرور. أعد المحاولة بأمان."));
    } catch {
      setPasswordMessage(tr("Connection failed. Check login status before retrying.",
        "فشل الاتصال. تحقق من حالة الدخول قبل إعادة المحاولة."));
    } finally { setPasswordBusy(false); }
  }

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

  async function removeAvatar(): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarDataUrl: null }),
      });
      if (!response.ok) {
        setMessage(tr("Unable to remove profile picture.", "تعذر إزالة الصورة الشخصية."));
        return false;
      }
      setAvatar(null);
      window.location.reload();
      return true;
    } catch {
      setMessage(tr("Connection interrupted; image removal was not confirmed.",
        "انقطع الاتصال ولم يتم تأكيد إزالة الصورة."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    setRecoveryCodes([]);
    try {
      const response = await fetch("/api/security/mfa/enroll", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.get("currentPassword") }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setEnrollment(body as Enrollment);
      } else setMessage(body.error === "invalid_password"
        ? tr("Current password is incorrect.", "كلمة المرور الحالية غير صحيحة.")
        : tr("Unable to start MFA enrollment.", "تعذر بدء إعداد المصادقة متعددة العوامل."));
    } catch {
      setMessage(tr("Connection interrupted; enrollment not confirmed.",
        "انقطع الاتصال ولم يتم تأكيد بدء إعداد المصادقة."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/mfa/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const codes: string[] = Array.isArray(body.recoveryCodes)
          ? body.recoveryCodes.filter((value: unknown): value is string => typeof value === "string")
          : [];
        // Never treat a successful enablement with missing recovery codes as
        // a completed visual flow: user needs a separate authenticated retry.
        setRecoveryCodes(codes);
        setEnrollment(null);
        setMessage(codes.length
          ? tr("MFA enabled. Save the recovery codes below now; they are shown only once.",
            "تم تفعيل المصادقة متعددة العوامل. احفظ رموز الاسترداد الآن لأنها تظهر مرة واحدة فقط.")
          : tr("MFA was enabled, but recovery codes were not returned. Contact an administrator before closing.",
            "تم تفعيل المصادقة لكن لم تُرجع رموز الاسترداد. اتصل بالمسؤول قبل إغلاق النافذة."));
      } else {
        setMessage(tr("Invalid authenticator code.", "رمز تطبيق المصادقة غير صحيح."));
      }
    } catch {
      setMessage(tr("Connection interrupted. Check enrollment status before retrying.",
        "انقطع الاتصال. تحقق من حالة المصادقة قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/security/mfa/disable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), code: form.get("code") }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        window.location.reload();
        return;
      }
      setMessage(body.error === "invalid_password"
        ? tr("Current password is incorrect.", "كلمة المرور الحالية غير صحيحة.")
        : tr("MFA code is invalid.", "رمز المصادقة غير صحيح."));
    } catch {
      setMessage(tr("Connection interrupted. Check MFA status before retrying.",
        "انقطع الاتصال. تحقق من حالة المصادقة قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  function dismissMfa() {
    if (busy) return;
    if (recoveryCodes.length) {
      setMessage(tr(
        "Save the one-time recovery codes and choose 'I saved the codes' before closing.",
        "احفظ رموز الاسترداد التي تظهر مرة واحدة، ثم اختر «حفظت الرموز» قبل الإغلاق."
      ));
      return;
    }
    setMfaOpen(false);
    setEnrollment(null);
    setMessage("");
  }

  function finishRecoveryCodes() {
    if (busy || !recoveryCodes.length) return;
    setRecoveryCodes([]);
    setEnrollment(null);
    setMfaOpen(false);
    window.location.reload();
  }

  async function confirmAvatarRemoval() {
    if (busy) return;
    const confirmed = await removeAvatar();
    if (confirmed) setAvatarRemovalOpen(false);
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
            <label className="secondary-button file-button">{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Choose image", "اختيار صورة")}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={e => void saveAvatar(e)} /></label>
            {avatar && <button type="button" className="secondary-button" disabled={busy}
              onClick={() => { setMessage(""); setAvatarRemovalOpen(true); }}>{tr("Remove image", "إزالة الصورة")}</button>}
          </div>
        </div>
      </div>
      {message && !mfaOpen && !avatarRemovalOpen && <p role="status" className="form-warning">{message}</p>}
    </article>

    <article className="detail-card">
      <div className="section-title-row">
        <div><p className="eyebrow">{tr("Staff Account", "حساب الموظف")}</p>
          <h2>{tr("Change Password", "تغيير كلمة المرور")}</h2></div>
      </div>
      <p className="muted">{tr(
        "Verify your current password. Changing it revokes every existing login session; your MFA settings remain unchanged.",
        "أكّد كلمة المرور الحالية. تغييرها ينهي جميع جلسات الدخول وتبقى إعدادات المصادقة متعددة العوامل كما هي.",
      )}</p>
      <button type="button" className="primary-button" disabled={passwordBusy}
        onClick={() => { setPasswordMessage(""); setPasswordOpen(true); }}>
        {tr("Change password", "تغيير كلمة المرور")}
      </button>
      <CrudModal open={passwordOpen} onClose={() => { if (!passwordBusy) setPasswordOpen(false); }}
        size="compact"
        title={tr("Change Password and Sign Out", "تغيير كلمة المرور وتسجيل الخروج")}
        description={tr(
          "This revokes ALL active staff sessions, including your current session. Existing MFA configuration is retained.",
          "يُلغي هذا الإجراء جميع جلسات الموظف النشطة بما فيها الحالية، مع الحفاظ على إعدادات المصادقة متعددة العوامل.",
        )}>
        {passwordOpen && <form className="form-stack" onSubmit={e => void changePassword(e)}>
          <label>{tr("Current password", "كلمة المرور الحالية")}
            <input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label>{tr("New password (minimum 12 characters)", "كلمة المرور الجديدة (12 محرفًا على الأقل)")}
            <input name="newPassword" type="password" minLength={12} required autoComplete="new-password" /></label>
          <label>{tr("Confirm new password", "تأكيد كلمة المرور الجديدة")}
            <input name="confirmPassword" type="password" minLength={12} required autoComplete="new-password" /></label>
          <label className="check-line">
            <input name="confirmLogout" type="checkbox" required />
            {tr("I understand that changing my password signs out all sessions.",
              "أؤكد علمي أن تغيير كلمة المرور سينهي جميع جلسات الدخول.")}
          </label>
          {passwordMessage && <p role="alert" className="form-warning">{passwordMessage}</p>}
          <button className="primary-button" disabled={passwordBusy}>
            {passwordBusy ? tr("Changing…", "جارٍ التغيير…") :
              tr("Change password and sign out", "تغيير كلمة المرور وتسجيل الخروج")}
          </button>
        </form>}
      </CrudModal>
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
      {mfaEnabled && mfaConfirmedAt && <p className="muted">{tr("Confirmed", "تم التأكيد")}: <SystemDateText value={mfaConfirmedAt} /></p>}
      <button type="button" className={mfaEnabled ? "secondary-button" : "primary-button"} disabled={busy}
        onClick={() => { setMessage(""); setMfaOpen(true); }}>
        {mfaEnabled ? tr("Manage MFA / Disable", "إدارة المصادقة / تعطيل")
          : tr("Set up MFA", "إعداد المصادقة متعددة العوامل")}
      </button>
      <CrudModal open={mfaOpen} onClose={dismissMfa} size="compact"
        title={mfaEnabled ? tr("Manage Multi-Factor Authentication", "إدارة المصادقة متعددة العوامل")
          : tr("Enroll Authenticator", "إعداد تطبيق المصادقة")}
        description={tr(
          "Security secrets and recovery codes are shown only in this protected session. MFA enrollment requires verification.",
          "تظهر أسرار الأمان ورموز الاسترداد في هذه الجلسة المحمية فقط. يتطلب التفعيل التحقق من الهوية.",
        )}>
        {mfaOpen && <>
          {!mfaEnabled && !enrollment && !recoveryCodes.length && <form className="form-stack" onSubmit={beginEnrollment}>
            <label>{tr("Current password", "كلمة المرور الحالية")}<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
            <button className="primary-button" disabled={busy}>{busy ? tr("Starting…", "جارٍ البدء…") : tr("Set up MFA", "إعداد المصادقة متعددة العوامل")}</button>
          </form>}

          {!mfaEnabled && enrollment && <>
            <div className="mfa-enrollment">
              <Image src={enrollment.qrDataUrl} alt={tr("Authenticator QR code", "رمز QR لتطبيق المصادقة")} width={190} height={190} unoptimized />
              <div>
                <strong>{tr("Scan this QR code", "امسح رمز QR")}</strong>
                <p className="muted">{tr("Or enter this secret manually in your authenticator app:", "أو أدخل هذا المفتاح يدويًا في تطبيق المصادقة:")}</p>
                <code className="security-secret" dir="ltr">{enrollment.secret}</code>
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
            <label className="check-line">
              <input type="checkbox" name="confirmDisable" required />
              {tr("I understand that disabling MFA weakens account protection and revokes other sessions.",
                "أؤكد علمي أن تعطيل المصادقة يضعف حماية الحساب ويُلغي الجلسات الأخرى.")}
            </label>
            <button className="danger-button" disabled={busy}>{busy ? tr("Disabling…", "جارٍ التعطيل…") : tr("Disable MFA", "تعطيل المصادقة")}</button>
          </form>}

          {recoveryCodes.length > 0 && <div className="mfa-enrollment" role="status">
            <div>
              <strong>{tr("Save these recovery codes now — they will never be shown again.", "احفظ رموز الاسترداد الآن — لن تظهر مرة أخرى.")}</strong>
              <p>{tr("Each code is single-use. Store them securely outside this device.",
                "كل رمز يُستخدم مرة واحدة. احفظها بأمان خارج هذا الجهاز.")}</p>
            </div>
            <div className="recovery-code-grid">{recoveryCodes.map(code => <code key={code} dir="ltr">{code}</code>)}</div>
            <button type="button" className="primary-button" onClick={finishRecoveryCodes}>
              {tr("I saved the codes — finish setup", "حفظت الرموز — إنهاء الإعداد")}
            </button>
          </div>}
          {message && <p className="form-warning" role={recoveryCodes.length ? "status" : "alert"}>{message}</p>}
        </>}
      </CrudModal>
    </article>

    <article className="detail-card">
      <p className="eyebrow">{tr("Recovery", "الاسترداد")}</p>
      <h2>{tr("Recovery Codes", "رموز الاسترداد")}</h2>
      <p className="muted">{mfaEnabled
        ? tr("Recovery codes were issued when MFA was enabled. They are not displayed again.", "تم إصدار رموز الاسترداد عند تفعيل المصادقة ولن يتم عرضها مرة أخرى.")
        : tr("Recovery codes will be generated after MFA is confirmed.", "سيتم إنشاء رموز الاسترداد بعد تأكيد المصادقة.")}</p>
    </article>

    <CrudModal open={avatarRemovalOpen} onClose={() => { if (!busy) setAvatarRemovalOpen(false); }}
      size="compact"
      title={tr("Remove Profile Picture", "إزالة الصورة الشخصية")}
      description={tr("Your profile identity remains unchanged. This removes the stored picture only.",
        "تبقى هوية الحساب دون تغيير؛ تُزال الصورة المحفوظة فقط.")}>
      {avatarRemovalOpen && <div className="form-stack">
        <p>{tr("Are you sure you want to remove your profile picture?", "هل تريد إزالة صورتك الشخصية؟")}</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void confirmAvatarRemoval()}>
          {busy ? tr("Removing…", "جارٍ الإزالة…") : tr("Confirm removal", "تأكيد إزالة الصورة")}
        </button>
        {message && <p role="alert" className="form-warning">{message}</p>}
      </div>}
    </CrudModal>
  </div>;
}
