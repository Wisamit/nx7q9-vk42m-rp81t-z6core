"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { SystemSettings, ThemePalette } from "@/lib/system-settings";
import { SystemIcon } from "@/components/system-icon";

const paletteFields: Array<[keyof ThemePalette, string, string]> = [
  ["primary", "Primary", "اللون الرئيسي"],
  ["primaryStrong", "Primary strong", "الرئيسي الداكن"],
  ["primarySoft", "Primary soft", "خلفية الرئيسي"],
  ["secondary", "Secondary", "الثانوي"],
  ["accent", "Accent", "المميز"],
  ["background", "Page background", "خلفية الصفحات"],
  ["surface", "Cards / surface", "البطاقات والأسطح"],
  ["surfaceSoft", "Soft surface", "الأسطح الناعمة"],
  ["surfaceRaised", "Raised surface", "الأسطح البارزة"],
  ["surfaceHover", "Hover surface", "خلفية المرور"],
  ["text", "Primary text", "النص الرئيسي"],
  ["textSubtle", "Subtle text", "النص الخافت"],
  ["onPrimary", "Text on primary", "النص فوق اللون الرئيسي"],
  ["muted", "Muted text", "النص الثانوي"],
  ["border", "Borders", "الحدود"],
  ["sidebar", "Sidebar", "القائمة الجانبية"],
  ["sidebarText", "Sidebar text", "نص القائمة"],
  ["success", "Success", "نجاح"],
  ["warning", "Warning", "تحذير"],
  ["danger", "Danger / critical", "خطر / حرج"],
  ["info", "Information", "معلومات"],
];

function imageToDataUrl(file: File, maxBytes = 1024 * 1024) {
  return new Promise<string>((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"].includes(file.type)) {
      reject(new Error("unsupported_image"));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error("image_too_large"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read_failed"));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export function SystemSettingsForm({ initial, locale, onSavePendingChange }: {
  initial: SystemSettings;
  locale: "ar" | "en";
  onSavePendingChange?: (pending: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  function set<K extends keyof SystemSettings>(key: K, next: SystemSettings[K]) {
    setValue(current => ({ ...current, [key]: next }));
  }

  function setColor(mode: "lightTheme" | "darkTheme", key: keyof ThemePalette, next: string) {
    setValue(current => ({ ...current, [mode]: { ...current[mode], [key]: next } }));
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>, key: "logoDataUrl" | "faviconDataUrl") {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    try {
      set(key, await imageToDataUrl(file));
    } catch (error) {
      setMessage(error instanceof Error && error.message === "image_too_large"
        ? tr("Image must be 1 MB or smaller.", "يجب ألا يتجاوز حجم الصورة 1 ميغابايت.")
        : tr("Use PNG, JPEG, WEBP or ICO.", "استخدم PNG أو JPEG أو WEBP أو ICO."));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // A ref blocks consecutive submits even before React renders busy=true.
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    onSavePendingChange?.(true);
    setMessage("");
    let acknowledgedSuccess = false;
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error === "invalid_image"
          ? tr("Logo or favicon is invalid.", "اللوغو أو الأيقونة غير صالحة.")
          : tr("Unable to save settings.", "تعذر حفظ الإعدادات."));
        return;
      }
      // Remain locked until the successful settings change reloads the UI.
      acknowledgedSuccess = true;
      setMessage(tr("Settings saved. Reloading the interface…", "تم حفظ الإعدادات. يتم تحديث الواجهة…"));
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      // Uncertain network outcome: retain edits, do not imply a successful save.
      setMessage(tr(
        "Connection error. The settings were not confirmed as saved. Review and try again.",
        "حدث خطأ في الاتصال. لم يتأكد حفظ الإعدادات؛ راجعها وأعد المحاولة.",
      ));
    } finally {
      if (!acknowledgedSuccess) {
        submitting.current = false;
        setBusy(false);
        onSavePendingChange?.(false);
      }
    }
  }

  return <form className="settings-layout" onSubmit={submit}>
    <section className="settings-card">
      <div className="settings-card-title"><SystemIcon name="image" /><div><h2>{tr("Center identity", "هوية المركز")}</h2><p>{tr("Names, logo and browser icon used across the LIS.", "الاسم واللوغو وأيقونة المتصفح المستخدمة في النظام.")}</p></div></div>
      <div className="settings-grid">
        <label>{tr("System name (English)", "اسم النظام بالإنجليزية")}<input value={value.systemNameEn} maxLength={200} onChange={e => set("systemNameEn", e.target.value)} /></label>
        <label>{tr("System name (Arabic)", "اسم النظام بالعربية")}<input value={value.systemNameAr} maxLength={200} onChange={e => set("systemNameAr", e.target.value)} /></label>
        <label>{tr("Organization name (English)", "اسم المؤسسة بالإنجليزية")}<input value={value.organizationNameEn} maxLength={200} onChange={e => set("organizationNameEn", e.target.value)} /></label>
        <label>{tr("Organization name (Arabic)", "اسم المؤسسة بالعربية")}<input value={value.organizationNameAr || ""} maxLength={200} onChange={e => set("organizationNameAr", e.target.value || null)} /></label>
      </div>
      <div className="branding-upload-grid">
        <div className="branding-upload">
          <strong>{tr("Logo", "اللوغو")}</strong>
          <div className="branding-preview logo-preview">{value.logoDataUrl ? <Image src={value.logoDataUrl} alt="Family Lab logo preview" width={240} height={110} unoptimized /> : <span>Family Lab</span>}</div>
          <input type="file" aria-label={tr("Upload center logo", "رفع شعار المركز")} accept="image/png,image/jpeg,image/webp" onChange={e => void handleImage(e, "logoDataUrl")} />
          {value.logoDataUrl && <button type="button" className="secondary-button" onClick={() => set("logoDataUrl", null)}>{tr("Remove custom logo", "إزالة اللوغو المخصص")}</button>}
        </div>
        <div className="branding-upload">
          <strong>{tr("Browser icon / favicon", "أيقونة المتصفح / Favicon")}</strong>
          <div className="branding-preview favicon-preview">{value.faviconDataUrl ? <Image src={value.faviconDataUrl} alt="Favicon preview" width={64} height={64} unoptimized /> : <span>FL</span>}</div>
          <input type="file" aria-label={tr("Upload browser icon", "رفع أيقونة المتصفح")} accept="image/png,image/x-icon,image/vnd.microsoft.icon" onChange={e => void handleImage(e, "faviconDataUrl")} />
          {value.faviconDataUrl && <button type="button" className="secondary-button" onClick={() => set("faviconDataUrl", null)}>{tr("Remove custom icon", "إزالة الأيقونة المخصصة")}</button>}
        </div>
      </div>
    </section>

    <section className="settings-card">
      <div className="settings-card-title"><SystemIcon name="globe" /><div><h2>{tr("Regional defaults", "الإعدادات الإقليمية")}</h2><p>{tr("Default timezone and display format used by the interface.", "المنطقة الزمنية وشكل العرض الافتراضي في الواجهة.")}</p></div></div>
      <div className="settings-grid">
        <label>{tr("Timezone", "المنطقة الزمنية")}<select value={value.timezone} onChange={e => set("timezone", e.target.value)}>
          <option value="Africa/Cairo">{tr("Africa/Cairo — Egypt", "Africa/Cairo — مصر")}</option><option value="Asia/Dubai">{tr("Asia/Dubai — UAE", "Asia/Dubai — الإمارات")}</option><option value="Asia/Riyadh">{tr("Asia/Riyadh — Saudi Arabia", "Asia/Riyadh — السعودية")}</option><option value="Asia/Beirut">{tr("Asia/Beirut — Lebanon", "Asia/Beirut — لبنان")}</option><option value="Asia/Damascus">{tr("Asia/Damascus — Syria", "Asia/Damascus — سوريا")}</option><option value="Europe/Istanbul">{tr("Europe/Istanbul — Türkiye", "Europe/Istanbul — تركيا")}</option><option value="UTC">UTC</option>
        </select></label>
        <label>{tr("Default language", "اللغة الافتراضية")}<select value={value.defaultLocale} onChange={e => set("defaultLocale", e.target.value as "en" | "ar")}><option value="en">{tr("English", "الإنجليزية")}</option><option value="ar">العربية</option></select></label>
        <label>{tr("Date format", "شكل التاريخ")}<select value={value.dateFormat} onChange={e => set("dateFormat", e.target.value as SystemSettings["dateFormat"])}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option><option>DD MMM YYYY</option></select></label>
        <label>{tr("Time format", "شكل الوقت")}<select value={value.timeFormat} onChange={e => set("timeFormat", e.target.value as "12" | "24")}><option value="12">{tr("12-hour", "12 ساعة")}</option><option value="24">{tr("24-hour", "24 ساعة")}</option></select></label>
        <label>{tr("Week starts on", "بداية الأسبوع")}<select value={value.weekStartsOn} onChange={e => set("weekStartsOn", Number(e.target.value) as 0 | 1 | 6)}><option value={1}>{tr("Monday", "الاثنين")}</option><option value={0}>{tr("Sunday", "الأحد")}</option><option value={6}>{tr("Saturday", "السبت")}</option></select></label>
        <label>{tr("Interface density", "كثافة الواجهة")}<select value={value.density} onChange={e => set("density", e.target.value as "COMFORTABLE" | "COMPACT")}><option value="COMFORTABLE">{tr("Comfortable", "مريحة")}</option><option value="COMPACT">{tr("Compact", "مضغوطة")}</option></select></label>
        <label className="settings-check"><input type="checkbox" checked={value.showSeconds} onChange={e => set("showSeconds", e.target.checked)} />{tr("Show seconds in header clock", "إظهار الثواني في ساعة الهيدر")}</label>
      </div>
    </section>

    <section className="settings-card">
      <div className="settings-card-title"><SystemIcon name="palette" /><div><h2>{tr("Appearance", "المظهر")}</h2><p>{tr("Complete Light and Dark palettes. Changes apply across the system.", "ألوان كاملة للوضع الفاتح والداكن وتطبق على كامل النظام.")}</p></div></div>
      <div className="settings-grid">
        <label>{tr("Default theme", "الوضع الافتراضي")}<select value={value.defaultTheme} onChange={e => set("defaultTheme", e.target.value as SystemSettings["defaultTheme"])}><option value="SYSTEM">{tr("Follow device", "حسب الجهاز")}</option><option value="LIGHT">{tr("Light", "فاتح")}</option><option value="DARK">{tr("Dark", "داكن")}</option></select></label>
      </div>
      <div className="theme-editor-grid">
        {(["lightTheme", "darkTheme"] as const).map(mode => <div className="theme-editor" key={mode}>
          <h3>{mode === "lightTheme" ? tr("Light mode", "الوضع الفاتح") : tr("Dark mode", "الوضع الداكن")}</h3>
          <div className="color-grid">{paletteFields.map(([key, en, ar]) => <label className="color-field" key={key}><span>{tr(en, ar)}</span><div><input type="color" value={value[mode][key]} onChange={e => setColor(mode, key, e.target.value)} /><input value={value[mode][key]} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onChange={e => setColor(mode, key, e.target.value)} /></div></label>)}</div>
        </div>)}
      </div>
    </section>

    <div className="settings-savebar">
      {message && <span className={message.includes("saved") || message.includes("تم حفظ") ? "form-success" : "form-error"}>{message}</span>}
      <button className="primary-button" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save system settings", "حفظ إعدادات النظام")}</button>
    </div>
  </form>;
}
