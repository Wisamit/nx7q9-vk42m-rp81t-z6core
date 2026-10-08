"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Channel = "EMAIL" | "SMS" | "WHATSAPP";
type RecipientType = "PATIENT" | "REFERRER" | "CLIENT";

type RecipientOption = {
  type: RecipientType;
  label: string;
  portalAccountId: string;
  channels: Array<{ channel: Channel; destinationMasked: string }>;
  verificationCandidates: Array<{ channel: "EMAIL" | "PHONE"; destinationMasked: string }>;
};

export function ReportOutboundDelivery({
  reportVersionId,
  recipients,
  locale,
  canVerifyContacts,
}: {
  reportVersionId: string;
  recipients: RecipientOption[];
  locale: "ar" | "en";
  canVerifyContacts: boolean;
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [recipientType, setRecipientType] = useState<RecipientType>(recipients[0]?.type || "PATIENT");
  const selectedRecipient = useMemo(
    () => recipients.find(item => item.type === recipientType) || recipients[0] || null,
    [recipientType, recipients],
  );
  const [channel, setChannel] = useState<Channel>(selectedRecipient?.channels[0]?.channel || "EMAIL");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function selectRecipient(value: RecipientType) {
    setRecipientType(value);
    const recipient = recipients.find(item => item.type === value);
    setChannel(recipient?.channels[0]?.channel || "EMAIL");
    setMessage("");
  }

  async function verifyContact(verificationChannel: "EMAIL" | "PHONE") {
    if (!selectedRecipient || !canVerifyContacts) return;
    const reason = window.prompt(tr(
      verificationChannel === "EMAIL"
        ? "Reason/evidence for confirming this email belongs to the portal recipient:"
        : "Reason/evidence for confirming this phone belongs to the portal recipient:",
      verificationChannel === "EMAIL"
        ? "سبب/دليل تأكيد أن البريد الإلكتروني يعود لمستلم البوابة:"
        : "سبب/دليل تأكيد أن رقم الهاتف يعود لمستلم البوابة:",
    ));
    if (!reason?.trim()) return;

    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/portal-accounts/${selectedRecipient.portalAccountId}/verify-contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: verificationChannel, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; destination?: string };
    setBusy(false);

    if (!response.ok) {
      setMessage(body.error === "contact_already_verified"
        ? tr("This contact is already verified.", "جهة الاتصال موثقة مسبقًا.")
        : tr("Could not verify the portal contact.", "تعذر توثيق جهة اتصال البوابة."));
      return;
    }

    setMessage(tr(
      `Verified ${verificationChannel === "EMAIL" ? "email" : "phone"} ${body.destination || ""}.`,
      `تم توثيق ${verificationChannel === "EMAIL" ? "البريد الإلكتروني" : "رقم الهاتف"} ${body.destination || ""}.`,
    ));
    router.refresh();
  }

  async function queueDelivery() {
    if (!selectedRecipient || !selectedRecipient.channels.some(item => item.channel === channel)) return;
    setBusy(true);
    setMessage("");

    const response = await fetch(`/api/reports/${reportVersionId}/outbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType, channel }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; destination?: string };
    setBusy(false);

    if (!response.ok) {
      const errors: Record<string, string> = {
        active_portal_account_required: tr("An active portal account is required for this recipient.", "يلزم حساب بوابة نشط لهذا المستلم."),
        verified_portal_contact_required: tr("The portal contact must be verified before sending a report notification.", "يجب التحقق من جهة اتصال البوابة قبل إرسال إشعار التقرير."),
        verified_email_required: tr("A verified portal email is required.", "يلزم بريد إلكتروني موثق في البوابة."),
        verified_phone_required: tr("A verified portal phone is required.", "يلزم رقم هاتف موثق في البوابة."),
        public_app_url_required: tr("A public application URL is required before secure links can be sent.", "يلزم عنوان عام للتطبيق قبل إرسال الروابط الآمنة."),
        corporate_report_access_required: tr("This corporate portal does not have active report access for the patient.", "لا تملك بوابة العميل المؤسسي صلاحية فعالة لعرض تقارير هذا المريض."),
        portal_account_type_mismatch: tr("The linked portal account type does not match the recipient.", "نوع حساب البوابة المرتبط لا يطابق نوع المستلم."),
        retracted_report_cannot_be_delivered: tr("A retracted report cannot be delivered.", "لا يمكن تسليم تقرير مسحوب."),
        superseded_report_cannot_be_delivered: tr("Only the latest report version can be delivered.", "يمكن تسليم أحدث إصدار من التقرير فقط."),
        report_version_changed_retry: tr("The report version changed during queueing. Refresh and review the latest report.", "تغير إصدار التقرير أثناء إضافته للإرسال. حدّث الصفحة وراجع التقرير الأحدث."),
        report_delivery_already_pending_or_sent: tr("This report is already queued or sent to the selected verified contact.", "هذا التقرير موجود بالفعل في قائمة الإرسال أو تم إرساله إلى جهة الاتصال المحددة."),
      };
      setMessage(errors[body.error || ""] || tr("Could not queue report delivery.", "تعذر وضع تسليم التقرير في قائمة الإرسال."));
      return;
    }

    setMessage(tr(
      `Queued for secure delivery to ${body.destination || "verified contact"}.`,
      `تمت إضافة التسليم الآمن إلى قائمة الإرسال نحو ${body.destination || "جهة الاتصال الموثقة"}.`,
    ));
    router.refresh();
  }

  const channelLabel = (value: Channel) =>
    value === "EMAIL" ? tr("Email", "البريد الإلكتروني")
      : value === "SMS" ? tr("SMS", "رسالة نصية")
        : tr("WhatsApp", "واتساب");

  return <section className="detail-card report-outbound-card no-print">
    <h2>{tr("Secure Report Delivery", "التسليم الآمن للتقرير")}</h2>
    <p className="muted">{tr(
      "External messages never contain laboratory result values. They notify a verified portal recipient and link to the authenticated portal report.",
      "الرسائل الخارجية لا تحتوي قيم النتائج المخبرية. يتم إشعار مستلم موثق وربطه بالتقرير داخل البوابة بعد تسجيل الدخول.",
    )}</p>

    {recipients.length === 0 ? <p className="muted">{tr(
      "No associated patient, doctor, or client has an active portal account with an email or phone contact.",
      "لا يوجد مريض أو طبيب أو عميل مرتبط لديه حساب بوابة نشط مع بريد إلكتروني أو رقم هاتف.",
    )}</p> : <div className="report-outbound-controls">
      <label>{tr("Recipient", "المستلم")}
        <select value={recipientType} onChange={event => selectRecipient(event.target.value as RecipientType)}>
          {recipients.map(recipient => <option key={recipient.type} value={recipient.type}>{recipient.label}</option>)}
        </select>
      </label>
      <label>{tr("Channel", "القناة")}
        <select value={channel} disabled={!selectedRecipient?.channels.length} onChange={event => setChannel(event.target.value as Channel)}>
          {(selectedRecipient?.channels || []).length === 0 && <option value="EMAIL">{tr("Verify a contact first", "وثّق جهة اتصال أولًا")}</option>}
          {(selectedRecipient?.channels || []).map(item =>
            <option key={item.channel} value={item.channel}>{channelLabel(item.channel)} · {item.destinationMasked}</option>
          )}
        </select>
      </label>
      <button
        className="primary-button"
        type="button"
        disabled={busy || !selectedRecipient || selectedRecipient.channels.length === 0}
        onClick={() => void queueDelivery()}
      >
        {busy ? tr("Queueing…", "جارٍ الإضافة…") : tr("Queue Secure Delivery", "إضافة التسليم الآمن")}
      </button>
    </div>}

    {selectedRecipient && selectedRecipient.verificationCandidates.length > 0 && <div className="report-contact-verification">
      <strong>{tr("Contact verification required", "يلزم توثيق جهة الاتصال")}</strong>
      <p className="muted">{canVerifyContacts
        ? tr("Confirm only after validating the destination with the recipient. The reason and staff actor are audited.", "قم بالتوثيق فقط بعد التحقق من جهة الاتصال مع المستلم. يتم تدقيق السبب وهوية الموظف.")
        : tr("A user with portal account management permission must verify the destination before report delivery.", "يجب على مستخدم لديه صلاحية إدارة حسابات البوابة توثيق جهة الاتصال قبل إرسال التقرير.")}</p>
      {canVerifyContacts && <div className="header-actions">
        {selectedRecipient.verificationCandidates.map(candidate => <button
          key={candidate.channel}
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void verifyContact(candidate.channel)}
        >{candidate.channel === "EMAIL" ? tr("Verify Email", "توثيق البريد") : tr("Verify Phone", "توثيق الهاتف")} · {candidate.destinationMasked}</button>)}
      </div>}
    </div>}

    {message && <p className="muted">{message}</p>}
  </section>;
}
