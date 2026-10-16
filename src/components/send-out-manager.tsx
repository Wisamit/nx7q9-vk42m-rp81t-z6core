"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { AttachmentManager } from "@/components/attachment-manager";
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
    const form = new FormData(event.currentTarget);
    setBusy("lab"); setMessage("");
    const response = await fetch("/api/send-outs/laboratories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("External laboratory created.", "تم إنشاء المختبر الخارجي."));
      event.currentTarget.reset();
      router.refresh();
    } else setMessage(tr("Could not create external laboratory.", "تعذر إنشاء المختبر الخارجي."));
    setBusy("");
  }

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = candidates.find(item => item.key === candidateKey);
    if (!candidate) { setMessage(tr("Select an order item/specimen.", "اختر فحص الطلب/العينة.")); return; }
    const form = new FormData(event.currentTarget);
    setBusy("referral"); setMessage("");
    const response = await fetch("/api/send-outs", {
      method: "POST", headers: { "Content-Type": "application/json" },
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
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Send-out referral created.", "تم إنشاء إحالة للمختبر الخارجي."));
      setCandidateKey("");
      event.currentTarget.reset();
      router.refresh();
    } else setMessage(tr("Could not create send-out referral.", "تعذر إنشاء الإحالة الخارجية."));
    setBusy("");
  }

  async function act(referralId: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(referralId + action); setMessage("");
    const response = await fetch(`/api/send-outs/${referralId}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Send-out updated.", "تم تحديث الإحالة الخارجية."));
      router.refresh();
    } else setMessage(tr("Send-out action failed.", "فشل إجراء الإحالة الخارجية."));
    setBusy("");
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
          <label>{tr("Expected result","موعد النتيجة المتوقع")}<input name="expectedResultAt" type="datetime-local" /></label>
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
            <div><span>{tr("Expected result","النتيجة المتوقعة")}</span><strong>{referral.expectedResultAt?.replace("T"," ").slice(0,16) || "—"}</strong></div>
            <div><span>{tr("Cost","التكلفة")}</span><strong>{referral.costAmount && referral.costCurrency ? referral.costAmount + " " + referral.costCurrency : "—"}</strong></div>
            <div><span>{tr("Dispatch","الإرسال")}</span><strong>{referral.dispatchedAt?.replace("T"," ").slice(0,16) || "—"}</strong></div>
          </div>

          <div className="sendout-actions">
            {canManage && referral.status === "CREATED" && <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(referral.id, "DISPATCH", {
                externalAccession: form.get("externalAccession"),
                courier: form.get("courier"),
                trackingReference: form.get("trackingReference"),
                note: form.get("note"),
              });
            }}>
              <input name="externalAccession" defaultValue={referral.externalAccession || ""} placeholder={tr("External accession","رقم الطلب الخارجي")} />
              <input name="courier" placeholder={tr("Courier","شركة النقل / المندوب")} />
              <input name="trackingReference" placeholder={tr("Tracking reference","مرجع التتبع")} />
              <input name="note" placeholder={tr("Dispatch note","ملاحظة الإرسال")} />
              <button className="primary-button" disabled={busy === referral.id + "DISPATCH"}>{tr("Dispatch","إرسال")}</button>
            </form>}

            {canManage && referral.status === "DISPATCHED" && <form onSubmit={event => {
              event.preventDefault();
              void act(referral.id, "RECEIVE_RESULT", {
                externalResultText: resultTexts[referral.id] || "",
                note: new FormData(event.currentTarget).get("note"),
              });
            }}>
              <textarea rows={3} value={resultTexts[referral.id] ?? referral.externalResultText ?? ""} onChange={event => setResultTexts(current => ({...current,[referral.id]:event.target.value}))} placeholder={tr("External result / interpretation (or upload report below)","النتيجة / التفسير الخارجي (أو ارفع التقرير أدناه)")} />
              <input name="note" placeholder={tr("Receipt note","ملاحظة الاستلام")} />
              <button className="primary-button" disabled={busy === referral.id + "RECEIVE_RESULT"}>{tr("Record Result Received","تسجيل استلام النتيجة")}</button>
            </form>}

            {canVerify && referral.status === "RESULT_RECEIVED" && <button className="primary-button" onClick={() => void act(referral.id, "VERIFY")} disabled={busy === referral.id + "VERIFY"}>{tr("Verify External Result","التحقق من النتيجة الخارجية")}</button>}
            {canVerify && referral.status === "VERIFIED" && <button className="primary-button" onClick={() => void act(referral.id, "COMPLETE")} disabled={busy === referral.id + "COMPLETE"}>{tr("Complete Send-out","إكمال الإحالة الخارجية")}</button>}
            {canManage && ["CREATED","DISPATCHED"].includes(referral.status) && <button className="secondary-button" onClick={() => {
              const note = prompt(tr("Cancellation reason:","سبب الإلغاء:"));
              if (note) void act(referral.id, "CANCEL", { note });
            }}>{tr("Cancel","إلغاء")}</button>}
          </div>

          {referral.externalResultText && <div className="sendout-result"><strong>{tr("External result","النتيجة الخارجية")}</strong><p>{referral.externalResultText}</p></div>}

          <div className="sendout-attachments">
            <h3>{tr("External report / attachments","التقرير الخارجي / المرفقات")}</h3>
            <AttachmentManager targetType="SEND_OUT_REFERRAL" targetId={referral.id} attachments={referral.attachments} canUpload={canUploadAttachments && canManage} locale={locale} />
          </div>

          <details className="specimen-history">
            <summary>{tr("Chain of custody / status history","سلسلة الحيازة / سجل الحالة")} ({referral.events.length})</summary>
            <div className="summary-list">{referral.events.map(event => <div key={event.id}>
              <span>{event.occurredAt.replace("T"," ").slice(0,19)} · {event.actor}</span>
              <strong>{referralStatusLabel(event.fromStatus || "NEW")} → {referralStatusLabel(event.toStatus)}{event.note ? " · " + event.note : ""}</strong>
            </div>)}</div>
          </details>
        </article>)
      }
    </section>
  </div>;
}
