"use client";

import {type FormEvent,useState} from "react";
import {CrudModal} from "@/components/crud-modal";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ReflexEvent = {
  id: string;
  status: string;
  targetTestId: string;
  sourceOrderId: string;
  createdAt: string;
  confirmedOrderItemId: string | null;
  triggerValue: string;
  targetTestCode: string;
  targetTestName: string;
  noteEn: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

type BilledCandidate = {
  orderItemId: string;
  orderId: string;
  invoiceLineId: string;
  testId: string;
  orderedAt: string;
  accessionNumber: string;
  testCode: string;
  invoiceNumber: string;
  lineTotal: string;
  currency: string;
};

export function ReflexReviewPanel({
  resultId,
  events,
  canReview,
  canConfirmOrder,
  billedCandidates,
  locale,
}: {
  resultId: string;
  events: ReflexEvent[];
  canReview: boolean;
  canConfirmOrder: boolean;
  billedCandidates: BilledCandidate[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [reviewTarget,setReviewTarget]=useState<{id:string;action:"ACKNOWLEDGE"|"DISMISS"|"CONFIRM_ORDERED"}|null>(null);
  const [reviewNote,setReviewNote]=useState("");

  function existingBilledCandidate(event:ReflexEvent) {
    return billedCandidates.find(x =>
      x.orderItemId+"|"+x.invoiceLineId===selected[event.id] &&
      x.testId===event.targetTestId &&
      (x.orderId===event.sourceOrderId || x.orderedAt>=event.createdAt));
  }
  function openReview(event:ReflexEvent,action:"ACKNOWLEDGE"|"DISMISS"|"CONFIRM_ORDERED") {
    if(busy || event.status!=="PENDING" || !canReview ||
      (action==="CONFIRM_ORDERED" && !canConfirmOrder))return;
    if(action==="CONFIRM_ORDERED" && !existingBilledCandidate(event)){
      setMessage(tr("Select a valid billed follow-up test.","اختر فحص متابعة مفوترًا وصالحًا."));
      return;
    }
    setMessage("");setReviewNote("");setReviewTarget({id:event.id,action});
  }
  async function confirmReview(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending=reviewTarget;
    if(!pending || busy || !canReview ||
      (pending.action==="CONFIRM_ORDERED" && !canConfirmOrder))return;
    const current=events.find(x=>x.id===pending.id && x.status==="PENDING");
    if(!current){setMessage(tr("Reflex recommendation changed; refresh before retrying.",
      "تغيّرت توصية Reflex؛ حدّث البيانات قبل إعادة المحاولة."));return;}
    const note=reviewNote.trim();
    if(note.length<10 || note.length>1000){
      setMessage(tr("A clinical reason between 10 and 1000 characters is required.",
        "يجب إدخال سبب سريري من 10 إلى 1000 حرف."));
      return;
    }
    const candidate=pending.action==="CONFIRM_ORDERED"?existingBilledCandidate(current):null;
    if(pending.action==="CONFIRM_ORDERED" &&
      (!candidate || new FormData(event.currentTarget).get("billingAcknowledged")!=="on")){
      setMessage(tr("Select an eligible billed follow-up and acknowledge its existing invoice.",
        "اختر فحص متابعة مفوتراً صالحاً وأكّد فاتورته الموجودة."));
      return;
    }
    setBusy(current.id+pending.action);setMessage("");
    try{
      const response=await fetch("/api/results/"+resultId+"/reflex/"+current.id,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:pending.action,note,
          ...(candidate?{targetOrderItemId:candidate.orderItemId,
            invoiceLineId:candidate.invoiceLineId,billingAcknowledged:true}:{}),
        }),
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){
        setMessage(body.error || tr("Reflex decision failed.","تعذر تسجيل قرار Reflex."));
        return;
      }
      setReviewTarget(null);
      setReviewNote("");
      setMessage(tr("Reflex decision recorded.","تم توثيق قرار Reflex."));
      router.refresh();
    }catch{
      setMessage(tr("Connection interrupted. Check the billed order and reflex state before retrying.",
        "انقطع الاتصال. تحقق من حالة فحص المتابعة المفوتر وتوصية Reflex قبل إعادة المحاولة."));
    }finally{setBusy("");}
  }

  if (events.length === 0) return null;

  return <div className="reflex-panel">
    <div>
      <h3>{tr("Reflex Recommendations", "توصيات الفحوصات الانعكاسية")}</h3>
      <p className="muted">{tr("These rules recommend follow-up testing. They do not automatically add tests or charges.", "توصي هذه القواعد بفحوصات متابعة ولا تضيف فحوصات أو رسومًا تلقائيًا.")}</p>
    </div>
    <div className="reflex-list">
      {events.map(event => <article className={`reflex-card reflex-${event.status.toLowerCase()}`} key={event.id}>
        <div>
          <span className="eyebrow">{event.status}</span>
          <strong>{event.targetTestCode} — {event.targetTestName}</strong>
          <small>{tr("Triggered by result value", "تم التفعيل بقيمة النتيجة")}: {event.triggerValue}</small>
          {event.noteEn && <small>{event.noteEn}</small>}
          {event.reviewedBy && <small>{tr("Reviewed by", "تمت المراجعة بواسطة")} {event.reviewedBy}{event.reviewedAt ? " · " + event.reviewedAt.replace("T"," ").slice(0,19) : ""}</small>}
          {event.confirmedOrderItemId && <small>{tr("Confirmed billed order item", "فحص المتابعة المفوتر والمؤكد")}: {event.confirmedOrderItemId}</small>}
          {event.reviewNote && <small>{tr("Review note", "ملاحظة المراجعة")}: {event.reviewNote}</small>}
        </div>
        {event.status === "PENDING" && canReview && <div className="result-actions" style={{flexWrap:"wrap"}}>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => openReview(event, "ACKNOWLEDGE")}>{tr("Reviewed only", "تمت المراجعة فقط")}</button>
          <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => openReview(event, "DISMISS")}>{tr("Dismiss", "رفض")}</button>
          {canConfirmOrder && <div>
            <label htmlFor={"reflex-candidate-" + event.id}>{tr("Existing invoice / test for confirmation", "فحص وفاتورة موجودان للتأكيد")}</label>
            <select id={"reflex-candidate-" + event.id} value={selected[event.id] || ""}
              onChange={e => setSelected(current => ({...current, [event.id]:e.target.value}))}>
              <option value="">{tr("Choose a billed follow-up item", "اختر فحص متابعة مفوترًا")}</option>
              {billedCandidates.filter(candidate => candidate.testId === event.targetTestId && (candidate.orderId === event.sourceOrderId || candidate.orderedAt >= event.createdAt))
                .map(candidate => <option key={candidate.orderItemId + candidate.invoiceLineId}
                  value={candidate.orderItemId + "|" + candidate.invoiceLineId}>
                  {candidate.accessionNumber} · {candidate.testCode} · {candidate.invoiceNumber} · {candidate.lineTotal} {candidate.currency}
                </option>)}
            </select>
            <button className="secondary-button" type="button" disabled={busy !== "" || !selected[event.id]}
              onClick={() => openReview(event, "CONFIRM_ORDERED")}>
              {tr("Confirm existing billed test", "تأكيد الفحص المفوتر الموجود")}
            </button>
            <p className="muted"><Link href="/orders">{tr("Register a new follow-up through the standard order and billing workflow", "سجّل فحص متابعة جديد عبر مسار الطلبات والفوترة المعتاد")}</Link></p>
          </div>}
        </div>}
      </article>)}
    </div>
    <CrudModal open={reviewTarget!==null} onClose={()=>{if(!busy)setReviewTarget(null);}}
      size="compact"
      title={reviewTarget?.action==="CONFIRM_ORDERED"
        ?tr("Confirm Existing Billed Reflex Test","تأكيد فحص Reflex مفوتر موجود")
        :reviewTarget?.action==="DISMISS"
          ?tr("Dismiss Reflex Recommendation","رفض توصية Reflex")
          :tr("Acknowledge Reflex Review","توثيق مراجعة Reflex")}
      description={tr(
        "Reflex recommendations never generate tests or patient charges automatically. Review the existing invoice, patient, specimen and clinical justification before confirming.",
        "لا تنشئ توصيات Reflex فحوصات أو رسوم مرضى تلقائياً. راجع الفاتورة الحالية والمريض والعينة والتبرير السريري قبل التأكيد.",
      )}>
      {reviewTarget&&(()=>{
        const current=events.find(x=>x.id===reviewTarget.id);
        if(!current)return <p role="alert" className="form-error">{tr("Reflex event unavailable.","توصية Reflex غير متاحة.")}</p>;
        const candidate=reviewTarget.action==="CONFIRM_ORDERED"?existingBilledCandidate(current):null;
        return <form className="catalog-form" onSubmit={confirmReview}>
          <div className="form-span">
            <strong>{current.targetTestCode} — {current.targetTestName}</strong>
            <p>{tr("Triggered result","النتيجة المُحفزة")}: {current.triggerValue}</p>
          </div>
          {reviewTarget.action==="CONFIRM_ORDERED"&&<div className="form-span">
            {candidate?<div>
              <strong>{candidate.accessionNumber} · {candidate.testCode}</strong>
              <p>{tr("Existing invoice","الفاتورة الموجودة")}: {candidate.invoiceNumber}</p>
              <p>{tr("Existing line total","إجمالي بند الفاتورة")}: {candidate.lineTotal} {candidate.currency}</p>
            </div>:<p role="alert" className="form-error">{tr("No eligible billed follow-up selected.",
              "لم يُحدد فحص متابعة مفوتر صالح.")}</p>}
          </div>}
          {reviewTarget.action==="CONFIRM_ORDERED"&&<label className="form-span">
            <input name="billingAcknowledged" type="checkbox" required/>
            {tr("I confirmed that this is the same patient's existing billed test; no new order or charge will be created.",
              "أؤكد أنه فحص مفوتر موجود لنفس المريض، ولن يُنشأ طلب أو رسم جديد.")}
          </label>}
          <label className="form-span">{tr("Clinical review reason (10–1000 characters)",
            "سبب المراجعة السريرية (10–1000 محرف)")}
            <textarea rows={3} minLength={10} maxLength={1000} required
              value={reviewNote} onChange={e=>setReviewNote(e.target.value)}/>
          </label>
          {message&&<p role="alert" className="form-warning form-span">{message}</p>}
          <button type="submit" className="primary-button form-span"
            disabled={Boolean(busy)||(reviewTarget.action==="CONFIRM_ORDERED"&&!candidate)}>
            {busy?tr("Saving…","جارٍ الحفظ…"):tr("Confirm Audited Clinical Decision","تأكيد القرار السريري المدقق")}
          </button>
        </form>;
      })()}
    </CrudModal>
    {message && <p role="status" className="form-warning">{message}</p>}
  </div>;
}
