"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Preference = { eventCode: string; channel: string; enabled: boolean };

export function NotificationCenterActions({
  notificationIds,
  preferences,
  canManage,
  canDispatch,
}: {
  notificationIds: string[];
  preferences: Preference[];
  canManage: boolean;
  canDispatch: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function markAllRead() {
    setBusy("read"); setMessage("");
    for (const id of notificationIds) {
      const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (!response.ok) {
        setMessage("Could not mark all notifications as read.");
        setBusy("");
        return;
      }
    }
    setBusy(""); setMessage("Notifications marked as read."); router.refresh();
  }

  async function togglePreference(eventCode: string, channel: string, enabled: boolean) {
    const key = `pref:${eventCode}:${channel}`;
    setBusy(key); setMessage("");
    const response = await fetch("/api/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventCode, channel, enabled }),
    });
    setBusy(""); setMessage(response.ok ? "Preference updated." : "Preference update failed.");
    if (response.ok) router.refresh();
  }

  async function dispatch() {
    setBusy("dispatch"); setMessage("");
    const response = await fetch("/api/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 100 }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? `Processed ${body.results?.length || 0} outbound deliveries.` : "Dispatch failed.");
    if (response.ok) router.refresh();
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("template"); setMessage("");
    const form = new FormData(event.currentTarget);
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
    setBusy("");
    setMessage(response.ok ? "Notification template created." : "Template creation failed.");
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
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
        {busy === "read" ? "Updating…" : "Mark all read"}
      </button>}
      {canDispatch && <button className="secondary-button" type="button" disabled={busy === "dispatch"} onClick={() => void dispatch()}>
        {busy === "dispatch" ? "Dispatching…" : "Dispatch outbound queue"}
      </button>}
    </div>

    {message && <div className="form-success">{message}</div>}

    <section className="detail-card">
      <h2>My Channel Preferences</h2>
      <p className="muted">In-app is the safe default. External channels only send when a destination and provider gateway are configured.</p>
      <div className="notification-preference-grid">
        {knownEvents.map(eventCode => <div className="notification-preference-row" key={eventCode}>
          <strong>{eventCode}</strong>
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
              <span>{channel}</span>
            </label>;
          })}
        </div>)}
      </div>
    </section>

    {canManage && <section className="detail-card">
      <h2>Create Notification Template</h2>
      <form className="catalog-form" onSubmit={createTemplate}>
        <label>Code<input name="code" required placeholder="CRITICAL_RESULT_EMAIL" /></label>
        <label>Event code<input name="eventCode" required placeholder="CRITICAL_RESULT_OPENED" /></label>
        <label>Channel<select name="channel" defaultValue="IN_APP"><option>IN_APP</option><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option></select></label>
        <label>Subject (English)<input name="subjectEn" /></label>
        <label dir="rtl">الموضوع بالعربية<input name="subjectAr" dir="rtl" /></label>
        <label className="form-span">Body (English)<textarea name="bodyEn" rows={4} required /></label>
        <label className="form-span" dir="rtl">النص بالعربية<textarea name="bodyAr" rows={4} dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy === "template"}>{busy === "template" ? "Saving…" : "Create Template"}</button>
      </form>
    </section>}
  </div>;
}
