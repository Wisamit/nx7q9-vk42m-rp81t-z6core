"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation"
import { CrudModal } from "@/components/crud-modal";

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
  const [reviewError, setReviewError] = useState("");
  const [pending, setPending] = useState<
    | {kind:"verify";recipient:RecipientOption;channel:"EMAIL"|"PHONE"}
    | {kind:"deliver";recipient:RecipientOption;channel:Channel}
    | null
  >(null);

  function selectRecipient(value: RecipientType) {
    setRecipientType(value);
    const recipient = recipients.find(item => item.type === value);
    setChannel(recipient?.channels[0]?.channel || "EMAIL");
    setMessage("");
  }

  function requestVerification(verificationChannel:"EMAIL"|"PHONE") {
    if (!selectedRecipient || !canVerifyContacts || busy) return;
    setMessage("");setReviewError("");
    setPending({kind:"verify",recipient:selectedRecipient,channel:verificationChannel});
  }

  function requestDelivery() {
    if (!selectedRecipient || busy ||
        !selectedRecipient.channels.some(item=>item.channel===channel)) return;
    setMessage("");setReviewError("");
    setPending({kind:"deliver",recipient:selectedRecipient,channel});
  }

  async function verifyContact(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || pending.kind!=="verify" || !canVerifyContacts || busy) return;
    const reason=String(new FormData(event.currentTarget).get("reason")||"").trim();
    if (!reason) {
      setReviewError(tr("Verification evidence is required.", "دليل التوثيق مطلوب."));
      return;
    }
    setBusy(true);setReviewError("");
    try {
      const response=await fetch(`/api/portal-accounts/${pending.recipient.portalAccountId}/verify-contact`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({channel:pending.channel,reason}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string;destination?:string};
      if(!response.ok) {
        setReviewError(body.error==="contact_already_verified"
          ?tr("This contact is already verified.", "جهة الاتصال موثقة مسبقًا.")
          :body.error||tr("Could not verify the portal contact.", "تعذر توثيق جهة اتصال البوابة."));
        return;
      }
      setMessage(tr(
        `Verified ${pending.channel==="EMAIL"?"email":"phone"} ${body.destination||""}.`,
        `تم توثيق ${pending.channel==="EMAIL"?"البريد الإلكتروني":"رقم الهاتف"} ${body.destination||""}.`,
      ));
      setPending(null);
      router.refresh();
    }catch{
      setReviewError(tr("Connection interrupted. Recheck verification before retrying.",
        "انقطع الاتصال؛ تحقق من حالة جهة الاتصال قبل المحاولة مجدداً."));
    }finally{setBusy(false);}
  }

  async function queueDelivery(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || pending.kind!=="deliver" || busy ||
        !pending.recipient.channels.some(item=>item.channel===pending.channel)) return;
    const destination=pending.recipient;
    const deliveryChannel=pending.channel;
    setBusy(true);setReviewError("");
    try {
      const response=await fetch(`/api/reports/${reportVersionId}/outbound`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({recipientType:destination.type,channel:deliveryChannel}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string;destination?:string};
      if(!response.ok){
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
          report_recipient_authorization_changed: tr("Recipient portal verification or report access changed. Nothing was queued. Refresh and confirm the verified recipient again.", "تغير توثيق جهة اتصال المستلم أو صلاحية الوصول إلى التقرير. لم يُضف أي إشعار إلى قائمة الإرسال. حدّث الصفحة وأعد التحقق من المستلم."),
          report_delivery_already_pending_or_sent: tr("This report is already queued or sent to the selected verified contact.", "هذا التقرير موجود بالفعل في قائمة الإرسال أو تم إرساله إلى جهة الاتصال المحددة."),
        };
        setReviewError(errors[body.error||""]||
          tr("Could not queue report delivery.", "تعذر وضع تسليم التقرير في قائمة الإرسال."));
        return;
      }
      setMessage(tr(
        `Queued for secure delivery to ${body.destination||"verified contact"}.`,
        `تمت إضافة التسليم الآمن إلى قائمة الإرسال نحو ${body.destination||"جهة الاتصال الموثقة"}.`,
      ));
      setPending(null);
      router.refresh();
    }catch{
      setReviewError(tr("Connection interrupted. Check delivery queue before retrying.",
        "انقطع الاتصال؛ تحقق من طابور التسليم قبل إعادة المحاولة."));
    }finally{setBusy(false);}
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
        onClick={requestDelivery}
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
          onClick={() => requestVerification(candidate.channel)}
        >{candidate.channel === "EMAIL" ? tr("Verify Email", "توثيق البريد") : tr("Verify Phone", "توثيق الهاتف")} · {candidate.destinationMasked}</button>)}
      </div>}
    </div>}

    {message && <p role="status" className="form-success">{message}</p>}
    <CrudModal open={pending!==null} onClose={()=>{if(!busy)setPending(null);}}
      size="compact"
      title={pending?.kind==="verify"
        ?tr("Verify Portal Recipient Contact", "توثيق جهة اتصال مستلم البوابة")
        :tr("Review Secure Report Delivery", "مراجعة التسليم الآمن للتقرير")}
      description={pending?.kind==="verify"
        ?tr("Verify identity and destination out of band before attesting this contact belongs to the selected portal recipient.",
          "تحقق من الهوية ووجهة الاتصال بوسيلة مستقلة قبل الإقرار بأنها تخص مستلم البوابة المحدد.")
        :tr("Only the latest released report can be queued. The external message contains no result values and links to the authenticated portal.",
          "لا يمكن إضافة سوى أحدث تقرير صادر لطابور الإرسال؛ لا تتضمن الرسالة الخارجية قيماً مخبرية وترتبط بالبوابة الآمنة.")}>
      {pending && <form className="catalog-form" onSubmit={pending.kind==="verify"?verifyContact:queueDelivery}>
        <div className="form-span">
          <strong>{tr("Recipient", "المستلم")}: {pending.recipient.label}</strong>
          <p>{tr("Channel", "القناة")}: {pending.channel==="PHONE"
            ?tr("Phone", "الهاتف"):channelLabel(pending.channel)}</p>
          <p dir="ltr">{pending.kind==="verify"
            ?pending.recipient.verificationCandidates.find(x=>x.channel===pending.channel)?.destinationMasked||"—"
            :pending.recipient.channels.find(x=>x.channel===pending.channel)?.destinationMasked||"—"}</p>
        </div>
        {pending.kind==="verify" && <label className="form-span">
          {tr("Verification reason and independently checked evidence", "سبب التوثيق والأدلة التي تم التحقق منها بشكل مستقل")}
          <textarea name="reason" rows={3} maxLength={1000} required />
        </label>}
        {pending.kind==="deliver" && <p className="muted form-span">{tr(
          "Confirm this masked recipient and delivery channel. Clinical result values are never embedded in the notification.",
          "أكّد المستلم المقنّع وقناة التسليم. لا يتم تضمين قيم النتائج السريرية في الإشعار.",
        )}</p>}
        {reviewError&&<p className="form-error form-span" role="alert">{reviewError}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy?tr("Processing…", "جارٍ التنفيذ…"):
            pending.kind==="verify"?tr("Confirm contact verification", "تأكيد توثيق جهة الاتصال"):
            tr("Confirm secure delivery queueing", "تأكيد إدراج التسليم الآمن")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
