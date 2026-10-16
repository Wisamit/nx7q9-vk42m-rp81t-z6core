"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Preference = { eventCode: string; channel: string; enabled: boolean };

export function NotificationCenterActions({
  notificationIds,
  preferences,
  canManage,
  canDispatch,
  locale,
}: {
  notificationIds: string[];
  preferences: Preference[];
  canManage: boolean;
  canDispatch: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const channelLabel = (value: string) => value === "IN_APP" ? tr("In-app", "داخل النظام") : value === "EMAIL" ? tr("Email", "البريد الإلكتروني") : value === "SMS" ? tr("SMS", "رسالة نصية") : value === "WHATSAPP" ? tr("WhatsApp", "واتساب") : value;
  const eventLabel = (value: string) => value === "CRITICAL_RESULT_OPENED" ? tr("Critical result opened", "فتح نتيجة حرجة") : value === "CRITICAL_RESULT_ESCALATED" ? tr("Critical result escalated", "تصعيد نتيجة حرجة") : value === "REPORT_RELEASED" ? tr("Report released", "إصدار تقرير") : value === "TAT_BREACH" ? tr("TAT breach", "تجاوز زمن الإنجاز") : value === "APPOINTMENT_REMINDER" ? tr("Appointment reminder", "تذكير بموعد") : value;

  async function markAllRead() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy("read");
    setMessage("");
    try {
      for (const id of notificationIds) {
        const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
        if (!response.ok) {
          setMessage(tr("Could not mark all notifications as read. Some items may already be updated.", "تعذر تعليم كل الإشعارات كمقروءة. قد تكون بعض العناصر قد تحدّثت بالفعل."));
          return;
        }
      }
      setMessage(tr("Notifications marked as read.", "تم تعليم الإشعارات كمقروءة."));
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Refresh to verify which notifications were marked read.", "انقطع الاتصال. حدّث الصفحة للتحقق من الإشعارات التي أصبحت مقروءة."));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function togglePreference(eventCode: string, channel: string, enabled: boolean) {
    if (submitting.current) return;
    submitting.current = true;
    const key = `pref:${eventCode}:${channel}`;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventCode, channel, enabled }),
      });
      setMessage(response.ok ? tr("Preference updated.", "تم تحديث التفضيل.") : tr("Preference update failed.", "فشل تحديث التفضيل."));
      if (response.ok) router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Refresh to verify the current notification preference.", "انقطع الاتصال. حدّث الصفحة للتحقق من التفضيل الحالي للإشعارات."));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function dispatch() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy("dispatch");
    setMessage("");
    try {
      const response = await fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      const body = await response.json().catch(() => ({}));
      setMessage(response.ok ? tr(
        `Created ${body.tatEscalations?.length || 0} TAT escalation(s) and processed ${body.results?.length || 0} outbound deliveries.`,
        `تم إنشاء ${body.tatEscalations?.length || 0} تصعيد TAT ومعالجة ${body.results?.length || 0} عملية تسليم صادرة.`,
      ) : tr("Dispatch failed.", "فشلت عملية الإرسال."));
      if (response.ok) router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Check the dispatch status before requesting another run.", "انقطع الاتصال. تحقق من حالة الإرسال قبل بدء محاولة جديدة."));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitting.current = true;
    setBusy("template");
    setMessage("");
    try {
      const response = await fetch("/api/notifications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          eventCode: form.get("eventCode"),
          channel: form.get("channel"),
          subjectEn: form.get("subjectEn"),
          subjectAr: form.get("subjectAr"),
          bodyEn: form.get("bodyEn"),
          bodyAr: form.get("bodyAr"),
        }),
      });
      if (!response.ok) {
        setMessage(tr("Template creation failed.", "فشل إنشاء القالب."));
        return;
      }
      formElement.reset();
      setUiEditor("");
      setMessage(tr("Notification template created.", "تم إنشاء قالب الإشعار."));
      router.refresh();
    } catch {
      setMessage(tr("Connection error. Check whether the template was created before retrying.", "حدث خطأ في الاتصال. تحقق من إنشاء القالب قبل إعادة المحاولة."));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  const knownEvents = [...new Set([
    "CRITICAL_RESULT_OPENED",
    "CRITICAL_RESULT_ESCALATED",
    "REPORT_RELEASED",
    "TAT_BREACH",
    "APPOINTMENT_REMINDER",
    ...preferences.map(item => item.eventCode),
  ])];

  return <div className="notification-actions-stack">
    <div className="notification-toolbar-actions">
      {notificationIds.length > 0 && <button className="secondary-button" type="button" disabled={busy === "read"} onClick={() => void markAllRead()}>
        {busy === "read" ? tr("Updating…", "جارٍ التحديث…") : tr("Mark all read", "تعليم الكل كمقروء")}
      </button>}
      {canDispatch && <button className="secondary-button" type="button" disabled={busy === "dispatch"} onClick={() => void dispatch()}>
        {busy === "dispatch" ? tr("Processing…", "جارٍ المعالجة…") : tr("Process alerts & outbound queue", "معالجة التنبيهات وقائمة الصادر")}
      </button>}
    </div>

    {message && <div className="form-success">{message}</div>}

    <section className="detail-card">
      <h2>{tr("My Channel Preferences", "تفضيلات قنواتي")}</h2>
      <p className="muted">{tr("In-app is the safe default. External channels only send when a destination and provider gateway are configured.", "الإشعار داخل النظام هو الافتراضي الآمن. القنوات الخارجية لا ترسل إلا عند تهيئة الوجهة وبوابة المزود.")}</p>
      <div className="notification-preference-grid">
        {knownEvents.map(eventCode => <div className="notification-preference-row" key={eventCode}>
          <strong>{eventLabel(eventCode)}</strong>
          {["IN_APP","EMAIL","SMS","WHATSAPP"].map(channel => {
            const current = preferences.find(item => item.eventCode === eventCode && item.channel === channel);
            const enabled = current ? current.enabled : channel === "IN_APP";
            const key = `pref:${eventCode}:${channel}`;
            return <label key={channel}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy === key}
                onChange={event => void togglePreference(eventCode, channel, event.target.checked)}
              />
              <span>{channelLabel(channel)}</span>
            </label>;
          })}
        </div>)}
      </div>
    </section>

    {canManage && <section className="detail-card">
      <h2>{tr("Create Notification Template", "إنشاء قالب إشعار")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("template"); }}>
     {tr("Create Notification Template", "إنشاء قالب إشعار")}
   </button>
   <CrudModal open={uiEditor === "template"} onClose={() => { if (!submitting.current) setUiEditor(""); }}
     size="compact" title={tr("Create Notification Template", "إنشاء قالب إشعار")}
     description={tr("Templates are configurable and notification events remain audited.", "القوالب قابلة للتهيئة وتظل أحداث الإشعارات موثقة.")}>
     {uiEditor === "template" && <form className="catalog-form" onSubmit={createTemplate}>
        <label>{tr("Code", "الرمز")}<input name="code" required placeholder="CRITICAL_RESULT_EMAIL" /></label>
        <label>{tr("Event code", "رمز الحدث")}<input name="eventCode" required placeholder="CRITICAL_RESULT_OPENED" /></label>
        <label>{tr("Channel", "القناة")}<select name="channel" defaultValue="IN_APP"><option value="IN_APP">{channelLabel("IN_APP")}</option><option value="EMAIL">{channelLabel("EMAIL")}</option><option value="SMS">{channelLabel("SMS")}</option><option value="WHATSAPP">{channelLabel("WHATSAPP")}</option></select></label>
        <label>{tr("Subject (English)", "الموضوع بالإنجليزية")}<input name="subjectEn" /></label>
        <label>{tr("Subject (Arabic)", "الموضوع بالعربية")}<input name="subjectAr" dir="rtl" /></label>
        <label className="form-span">{tr("Body (English)", "النص بالإنجليزية")}<textarea name="bodyEn" rows={4} required /></label>
        <label className="form-span">{tr("Body (Arabic)", "النص بالعربية")}<textarea name="bodyAr" rows={4} dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy === "template"}>{busy === "template" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Template", "إنشاء القالب")}</button>
      </form>}
     {uiEditor === "template" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}
  </div>;
}
