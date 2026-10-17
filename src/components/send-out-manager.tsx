"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { AttachmentManager } from "@/components/attachment-manager";
import { SystemDateText } from "@/components/system-date-text";
import { SystemDateTimeField } from "@/components/system-date-time-field";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type Laboratory = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Candidate = {
  key: string;
  orderItemId: string;
  specimenId: string;
  branchId: string;
  label: string;
};
type AttachmentItem = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
};
type Referral = {
  id: string;
  status: string;
  branchCode: string;
  branchTimeZone: string;
  accessionNumber: string;
  patientNumber: string;
  patientName: string;
  testCode: string;
  testName: string;
  specimenBarcode: string | null;
  laboratoryCode: string;
  laboratoryName: string;
  externalAccession: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  expectedResultAt: string | null;
  courier: string | null;
  trackingReference: string | null;
  dispatchedAt: string | null;
  resultReceivedAt: string | null;
  externalResultText: string | null;
  verifiedAt: string | null;
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; occurredAt: string; actor: string; note: string | null }>;
  attachments: AttachmentItem[];
};

export function SendOutManager({
  laboratories,
  candidates,
  referrals,
  canManage,
  canVerify,
  canUploadAttachments,
  locale,
}: {
  laboratories: Laboratory[];
  candidates: Candidate[];
  referrals: Referral[];
  canManage: boolean;
  canVerify: boolean;
  canUploadAttachments: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const [review, setReview] = useState<{
    id: string; action:"DISPATCH"|"RECEIVE_RESULT"|"VERIFY"|"COMPLETE"|"CANCEL";
  } | null>(null);
  const [actionError, setActionError] = useState("");
  function reviewAction(id: string, action:"DISPATCH"|"RECEIVE_RESULT"|"VERIFY"|"COMPLETE"|"CANCEL") {
    if (busy) return;
    setMessage("");setActionError("");
    setReview({id,action});
  }
  const [busy, setBusy] = useState("");
  const [candidateKey, setCandidateKey] = useState("");
  const [resultTexts, setResultTexts] = useState<Record<string, string>>({});
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const labName = (lab: Laboratory) => locale === "ar" ? lab.nameAr || lab.nameEn : lab.nameEn;
  const referralStatusLabel = (value: string) =>
    value === "CREATED" ? tr("Created", "تم الإنشاء") :
    value === "DISPATCHED" ? tr("Dispatched", "تم الإرسال") :
    value === "RESULT_RECEIVED" ? tr("Result received", "تم استلام النتيجة") :
    value === "VERIFIED" ? tr("Verified", "تم التحقق") :
    value === "COMPLETED" ? tr("Completed", "مكتمل") :
    value === "CANCELLED" ? tr("Cancelled", "ملغى") :
    value === "NEW" ? tr("New", "جديد") :
    sharedStatusLabel(locale, value);

  async function createLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("lab");
    setMessage("");
    try {
      const response = await fetch("/api/send-outs/laboratories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr("Could not create external laboratory.", "تعذر إنشاء المختبر الخارجي."));
        return;
      }
      setUiEditor("");
      setMessage(tr("External laboratory created.", "تم إنشاء المختبر الخارجي."));
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Check existing laboratories before trying again.",
        "انقطع الاتصال. راجع قائمة المختبرات الخارجية قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
  }

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const candidate = candidates.find(item => item.key === candidateKey);
    if (!candidate) {
      setMessage(tr("Select an order item/specimen.", "اختر فحص الطلب/العينة."));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy("referral");
    setMessage("");
    try {
      const response = await fetch("/api/send-outs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: candidate.branchId,
          orderItemId: candidate.orderItemId,
          specimenId: candidate.specimenId,
          externalLaboratoryId: form.get("externalLaboratoryId"),
          externalAccession: form.get("externalAccession"),
          costAmount: form.get("costAmount"),
          costCurrency: form.get("costCurrency"),
          expectedResultAt: form.get("expectedResultAt"),
          note: form.get("note"),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr("Could not create send-out referral.", "تعذر إنشاء الإحالة الخارجية."));
        return;
      }
      setUiEditor("");
      setCandidateKey("");
      setMessage(tr("Send-out referral created.", "تم إنشاء إحالة للمختبر الخارجي."));
      router.refresh();
    } catch {
      setMessage(tr(
        "Connection interrupted. Verify the specimen's referral history before any retry; submission may have completed.",
        "انقطع الاتصال. تحقق من تاريخ إحالات العينة قبل إعادة المحاولة؛ فقد يكون الطلب قد نُفّذ.",
      ));
    } finally {
      setBusy("");
    }
  }

  async function act(referralId: string, action: string, payload: Record<string, unknown> = {}) {
    if (busy) return false;
    setBusy(referralId + action); setActionError("");
    try {
      const response = await fetch(`/api/send-outs/${referralId}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setActionError(body.error || tr("Send-out action failed.", "فشل إجراء الإحالة الخارجية."));
        return false;
      }
      setMessage(tr("Send-out updated.", "تم تحديث الإحالة الخارجية."));
      router.refresh();
      return true;
    } catch {
      setActionError(tr("Connection interrupted. Recheck the custody and referral status before retrying.",
        "انقطع الاتصال؛ تحقق من سلسلة حيازة العينة وحالة الإحالة قبل إعادة المحاولة."));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function confirmReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || busy) return;
    const referral = referrals.find(item => item.id === review.id);
    if (!referral) {
      setActionError(tr("Referral not available.", "الإحالة غير متاحة."));
      return;
    }
    const form = new FormData(event.currentTarget);
    const action = review.action;
    const statusAllowed = action === "DISPATCH" ? referral.status === "CREATED" && canManage
      : action === "RECEIVE_RESULT" ? referral.status === "DISPATCHED" && canManage
      : action === "VERIFY" ? referral.status === "RESULT_RECEIVED" && canVerify
      : action === "COMPLETE" ? referral.status === "VERIFIED" && canVerify
      : ["CREATED","DISPATCHED"].includes(referral.status) && canManage;
    if (!statusAllowed) {
      setActionError(tr("This action is not allowed for the current referral state.",
        "الإجراء غير مسموح في حالة الإحالة الحالية."));
      return;
    }
    let payload: Record<string, unknown> = {};
    if (action === "DISPATCH") {
      payload = {
        externalAccession: form.get("externalAccession"),
        courier: form.get("courier"),
        trackingReference: form.get("trackingReference"),
        note: form.get("note"),
      };
    } else if (action === "RECEIVE_RESULT") {
      payload = {
        externalResultText: resultTexts[referral.id] ?? referral.externalResultText ?? "",
        note: form.get("note"),
      };
    } else if (action === "CANCEL") {
      const note = String(form.get("note") || "").trim();
      if (!note) {
        setActionError(tr("Documented cancellation reason required.", "سبب الإلغاء الموثق مطلوب."));
        return;
      }
      payload = { note };
    }
    const success = await act(referral.id, action, payload);
    if (success) setReview(null);
  }

  return <div className="sendout-workspace">
    {canManage && <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr("External Laboratory","مختبر خارجي")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("lab"); }}>
     {tr("Register External Laboratory", "تسجيل مختبر خارجي")}
   </button>
   <CrudModal open={uiEditor === "lab"} onClose={() => {if (!busy) setUiEditor("");}}
     size="compact" title={tr("Register External Laboratory", "تسجيل مختبر خارجي")}
     description={tr("External labs need governed identities and branch-scoped contracts.", "تحتاج المختبرات الخارجية إلى هوية مضبوطة وعقود محددة النطاق.")}>
     {uiEditor === "lab" && <form className="catalog-form" onSubmit={createLab}>
          <label>{tr("Code","الرمز")}<input name="code" required /></label>
          <label>{tr("Name (English)","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Phone","الهاتف")}<input name="phone" /></label>
          <label>{tr("Email","البريد الإلكتروني")}<input name="email" type="email" /></label>
          <label className="form-span">{tr("Address","العنوان")}<textarea name="address" rows={2} /></label>
          <button className="secondary-button form-span" disabled={busy === "lab"}>{busy === "lab" ? tr("Saving…","جارٍ الحفظ…") : tr("Add External Laboratory","إضافة مختبر خارجي")}</button>
        </form>}
     {uiEditor === "lab" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
      </article>

      <article className="detail-card">
        <h2>{tr("Create Send-out","إنشاء إحالة خارجية")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("referral"); }}>
     {tr("Create Send-out Referral", "إنشاء إحالة خارجية")}
   </button>
   <CrudModal open={uiEditor === "referral"} onClose={() => {if (!busy) setUiEditor("");}}
     size="compact" title={tr("Create Send-out Referral", "إنشاء إحالة خارجية")}
     description={tr("Review specimen barcode, custody and destination before creating a referral.", "راجع باركود العينة وسلسلة الحيازة والوجهة قبل إنشاء الإحالة.")}>
     {uiEditor === "referral" && <form className="catalog-form" onSubmit={createReferral}>
          <label className="form-span">{tr("Ordered test / specimen","الفحص المطلوب / العينة")}<select value={candidateKey} onChange={event => setCandidateKey(event.target.value)} required>
            <option value="">{tr("Select…","اختر…")}</option>
            {candidates.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>
          <label className="form-span">{tr("External laboratory","المختبر الخارجي")}<select name="externalLaboratoryId" required>
            <option value="">{tr("Select…","اختر…")}</option>
            {laboratories.map(lab => <option key={lab.id} value={lab.id}>{lab.code} — {labName(lab)}</option>)}
          </select></label>
          <label>{tr("External accession","رقم الطلب الخارجي")}<input name="externalAccession" /></label>
          <label>{tr("Expected result (selected branch local time)","موعد النتيجة المتوقع (توقيت الفرع المختار)")}<SystemDateTimeField name="expectedResultAt" /></label>
          <label>{tr("Cost","التكلفة")}<input name="costAmount" type="number" min="0" step="0.0001" /></label>
          <label>{tr("Currency","العملة")}<input name="costCurrency" maxLength={3} placeholder="AED" /></label>
          <label className="form-span">{tr("Note","ملاحظة")}<input name="note" /></label>
          <button className="primary-button form-span" disabled={busy === "referral"}>{busy === "referral" ? tr("Creating…","جارٍ الإنشاء…") : tr("Create Send-out Referral","إنشاء إحالة خارجية")}</button>
        </form>}
     {uiEditor === "referral" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
      </article>
    </section>}

    {message && <p className="form-success">{message}</p>}

    <section className="sendout-list">
      {referrals.length === 0 ? <article className="detail-card"><p className="empty-state">{tr("No send-out referrals.","لا توجد إحالات خارجية.")}</p></article> :
        referrals.map(referral => <article className="detail-card sendout-card" key={referral.id}>
          <div className="sendout-head">
            <div>
              <span className={"status-badge status-" + referral.status.toLowerCase().replaceAll("_","-")}>{referralStatusLabel(referral.status)}</span>
              <h2>{referral.testCode} — {referral.testName}</h2>
              <p className="muted">{referral.accessionNumber} · {referral.patientNumber} · {referral.patientName}</p>
            </div>
            <div className="sendout-lab"><small>{tr("Referral laboratory","المختبر المرجعي")}</small><strong>{referral.laboratoryCode} — {referral.laboratoryName}</strong></div>
          </div>

          <div className="specimen-metadata">
            <div><span>{tr("Branch","الفرع")}</span><strong>{referral.branchCode}</strong></div>
            <div><span>{tr("Specimen","العينة")}</span><strong className="barcode-text">{referral.specimenBarcode || "—"}</strong></div>
            <div><span>{tr("External accession","رقم الطلب الخارجي")}</span><strong>{referral.externalAccession || "—"}</strong></div>
            <div><span>{tr("Expected result","النتيجة المتوقعة")}</span><strong>{referral.expectedResultAt ? <SystemDateText value={referral.expectedResultAt} timeZone={referral.branchTimeZone} /> : "—"}</strong></div>
            <div><span>{tr("Cost","التكلفة")}</span><strong>{referral.costAmount && referral.costCurrency ? referral.costAmount + " " + referral.costCurrency : "—"}</strong></div>
            <div><span>{tr("Dispatch","الإرسال")}</span><strong>{referral.dispatchedAt ? <SystemDateText value={referral.dispatchedAt} timeZone={referral.branchTimeZone} /> : "—"}</strong></div>
          </div>

          <div className="sendout-actions">
            {canManage && referral.status === "CREATED" &&
              <button type="button" className="primary-button" disabled={Boolean(busy)}
                onClick={() => reviewAction(referral.id, "DISPATCH")}>
                {tr("Dispatch","إرسال")}
              </button>}
            {canManage && referral.status === "DISPATCHED" &&
              <button type="button" className="primary-button" disabled={Boolean(busy)}
                onClick={() => reviewAction(referral.id, "RECEIVE_RESULT")}>
                {tr("Record Result Received","تسجيل استلام النتيجة")}
              </button>}
            {canVerify && referral.status === "RESULT_RECEIVED" &&
              <button type="button" className="primary-button" disabled={Boolean(busy)}
                onClick={() => reviewAction(referral.id, "VERIFY")}>
                {tr("Verify External Result","التحقق من النتيجة الخارجية")}
              </button>}
            {canVerify && referral.status === "VERIFIED" &&
              <button type="button" className="primary-button" disabled={Boolean(busy)}
                onClick={() => reviewAction(referral.id, "COMPLETE")}>
                {tr("Complete Send-out","إكمال الإحالة الخارجية")}
              </button>}
            {canManage && ["CREATED","DISPATCHED"].includes(referral.status) &&
              <button type="button" className="secondary-button" disabled={Boolean(busy)}
                onClick={() => reviewAction(referral.id, "CANCEL")}>
                {tr("Cancel","إلغاء")}
              </button>}
          </div>

          {referral.externalResultText && <div className="sendout-result"><strong>{tr("External result","النتيجة الخارجية")}</strong><p>{referral.externalResultText}</p></div>}

          <div className="sendout-attachments">
            <h3>{tr("External report / attachments","التقرير الخارجي / المرفقات")}</h3>
            <AttachmentManager targetType="SEND_OUT_REFERRAL" targetId={referral.id} attachments={referral.attachments} canUpload={canUploadAttachments && canManage} locale={locale} />
          </div>

          <details className="specimen-history">
            <summary>{tr("Chain of custody / status history","سلسلة الحيازة / سجل الحالة")} ({referral.events.length})</summary>
            <div className="summary-list">{referral.events.map(event => <div key={event.id}>
              <span><SystemDateText value={event.occurredAt} timeZone={referral.branchTimeZone} /> · {event.actor}</span>
              <strong>{referralStatusLabel(event.fromStatus || "NEW")} → {referralStatusLabel(event.toStatus)}{event.note ? " · " + event.note : ""}</strong>
            </div>)}</div>
          </details>
        </article>)
      }
    </section>
    <CrudModal open={review !== null} onClose={() => { if (!busy) setReview(null); }}
      size="compact"
      title={review?.action === "DISPATCH"
        ? tr("Dispatch External Specimen","إرسال العينة للمختبر الخارجي")
        : review?.action === "RECEIVE_RESULT"
          ? tr("Record External Result Receipt","تسجيل استلام النتيجة الخارجية")
          : review?.action === "VERIFY"
            ? tr("Verify External Result","التحقق من النتيجة الخارجية")
            : review?.action === "COMPLETE"
              ? tr("Complete Send-out Referral","إكمال الإحالة الخارجية")
              : tr("Cancel Send-out Referral","إلغاء الإحالة الخارجية")}
      description={tr(
        "Review exact patient, accession, specimen barcode, external destination and status. Chain-of-custody and independent result verification remain enforced server-side.",
        "راجع المريض ورقم الطلب وباركود العينة والوجهة الخارجية والحالة. تبقى سلسلة الحيازة والاعتماد المستقل للنتائج خاضعين لقيود السيرفر.",
      )}>
      {review && (() => {
        const current = referrals.find(item => item.id === review.id);
        if (!current) return <p className="form-error" role="alert">{tr("Referral unavailable.", "الإحالة غير متاحة.")}</p>;
        return <form key={current.id + review.action} className="catalog-form" onSubmit={confirmReview}>
          <div className="form-span">
            <strong>{current.accessionNumber} · {current.patientNumber} · {current.patientName}</strong>
            <p>{current.testCode} — {current.testName}</p>
            <p>{tr("Specimen barcode","باركود العينة")}: <span dir="ltr">{current.specimenBarcode || "—"}</span></p>
            <p>{tr("External laboratory","المختبر الخارجي")}: {current.laboratoryCode} — {current.laboratoryName}</p>
            <p>{tr("Status","الحالة")}: {referralStatusLabel(current.status)}</p>
          </div>
          {review.action === "DISPATCH" && <>
            <label className="form-span">{tr("External accession","رقم الطلب الخارجي")}
              <input name="externalAccession" defaultValue={current.externalAccession||""}/></label>
            <label className="form-span">{tr("Courier / collection agent","شركة النقل / المندوب")}
              <input name="courier"/></label>
            <label className="form-span">{tr("Tracking reference","مرجع التتبع")}
              <input name="trackingReference"/></label>
            <label className="form-span">{tr("Dispatch notes","ملاحظات الإرسال")}
              <textarea name="note" rows={2}/></label>
          </>}
          {review.action === "RECEIVE_RESULT" && <>
            <label className="form-span">{tr("External result / interpretation (or upload the report first)",
              "النتيجة / التفسير الخارجي (أو ارفع التقرير أولاً)")}
              <textarea rows={4} value={resultTexts[current.id]??current.externalResultText??""}
                onChange={event => setResultTexts(existing => ({...existing,[current.id]:event.target.value}))}/>
            </label>
            <label className="form-span">{tr("Receipt note","ملاحظة الاستلام")}
              <textarea name="note" rows={2}/></label>
          </>}
          {review.action === "CANCEL" && <label className="form-span">
            {tr("Documented cancellation reason","سبب الإلغاء الموثق")}
            <textarea name="note" required rows={3} maxLength={1000}/>
          </label>}
          {review.action === "VERIFY" && <p className="muted form-span">{tr(
            "Verify the received external result and its supporting evidence. This is not automatic release of an internal diagnostic report.",
            "تحقق من النتيجة الخارجية والأدلة الداعمة. هذا ليس إصداراً آلياً لتقرير تشخيصي داخلي.",
          )}</p>}
          {review.action === "COMPLETE" && <p className="muted form-span">{tr(
            "Confirm the externally verified referral is complete and its custody events have been reviewed.",
            "أكّد اكتمال الإحالة المعتمدة خارجياً بعد مراجعة أحداث سلسلة الحيازة.",
          )}</p>}
          {actionError && <p className="form-error form-span" role="alert">{actionError}</p>}
          <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
            {busy ? tr("Processing…","جارٍ التنفيذ…") :
              tr("Confirm governed referral action","تأكيد إجراء الإحالة المحكوم")}
          </button>
        </form>;
      })()}
    </CrudModal>
  </div>;
}
