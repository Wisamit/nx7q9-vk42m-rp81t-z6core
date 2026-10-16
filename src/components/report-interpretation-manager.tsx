"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Comment = {
  id:string; revisionNumber:number; status:string;
  textEn:string; textAr:string; createdBy:string;
  createdAt:string; reviewReason:string|null; fingerprint:string;
};
export function ReportInterpretationManager({orderId,accession,locale,notes,
  canAuthor,canApprove,currentUserId,issuedVersion}:{
    orderId:string;accession:string;locale:"ar"|"en";notes:Comment[];
    canAuthor:boolean;canApprove:boolean;currentUserId:string;issuedVersion:number;
  }) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const router=useRouter();
  const latest=notes[0], approved=notes.find(n=>n.status==="APPROVED");
  const [textEn,setTextEn]=useState(approved?.textEn||"");
  const [textAr,setTextAr]=useState(approved?.textAr||"");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [formError,setFormError]=useState("");
  const [createOpen,setCreateOpen]=useState(false);
  const [reviewAction,setReviewAction]=useState<"APPROVE"|"REJECT"|null>(null);
  async function create(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    setBusy(true);setFormError("");
    try {
      const r=await fetch("/api/reports/interpretations",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderId,textEn,textAr})});
      const data=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok){setFormError(data.error||tr("Unable to save draft.","تعذر حفظ المسودة."));return;}
      setCreateOpen(false);
      setMessage(tr("Draft saved for a separate reviewer.","تم حفظ المسودة للمراجع المستقل."));
      router.refresh();
    }catch{setFormError(tr("Connection failure. Verify before retrying.","فشل الاتصال. تحقق قبل إعادة المحاولة."));}
    finally{setBusy(false);}
  }
  function openReview(action:"APPROVE"|"REJECT") {
    if (!latest || busy || !canApprove || latest.status!=="DRAFT" || latest.createdBy===currentUserId) return;
    setReason("");
    setFormError("");
    setMessage("");
    setReviewAction(action);
  }

  async function decide(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!reviewAction || !latest || busy || !canApprove || latest.status!=="DRAFT" ||
      latest.createdBy===currentUserId)return;
    const decision=reviewAction;
    if(reason.trim().length<10||reason.trim().length>1000) {
      setFormError(tr("A clinical decision reason of 10–1000 characters is required.",
        "يجب كتابة سبب القرار السريري بين 10 و1000 محرف."));
      return;
    }
    setBusy(true);setFormError("");
    try{
      const r=await fetch("/api/reports/interpretations",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          id:latest.id,expectedFingerprint:latest.fingerprint,
          decision,reason:reason.trim(),
          confirmation:decision==="APPROVE"?
            "APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION":null,
        }),
      });
      const data=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok){setFormError(data.error||tr("Clinical review failed.","فشلت المراجعة السريرية."));return;}
      setReason("");
      setReviewAction(null);
      setMessage(tr("Decision recorded. Previously issued report versions are unchanged.",
        "تم تسجيل القرار؛ إصدارات التقارير السابقة لم تتغير."));
      router.refresh();
    }catch{setFormError(tr("Connection failure. Check status before retrying.",
      "فشل الاتصال. تحقق من الحالة قبل إعادة المحاولة."));}
    finally{setBusy(false);}
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>{tr("Report-level clinical interpretation","التفسير السريري على مستوى التقرير")} · {accession}</h2>
      <p className="muted">{tr("Comments enter only newly issued report snapshots. Approving after a report has been issued does not republish or silently amend it.",
        "لا تظهر التعليقات إلا ضمن نسخ التقارير التي تصدر لاحقًا. اعتمادها بعد إصدار تقرير لا يعيد إصداره أو يعدّله تلقائيًا.")}</p>
      {issuedVersion>0 && <p className="form-warning">{tr(
        "Issued reports exist. New interpretations require a subsequent authorized report version to appear; prior versions are immutable.",
        "توجد تقارير صادرة. سيظهر التفسير الجديد فقط بإصدار تقرير لاحق معتمد؛ الإصدارات السابقة ثابتة.",
      )}</p>}
      {approved && <div>
        <strong>{tr("Current approved interpretation","التفسير المعتمد حاليًا")} v{approved.revisionNumber}</strong>
        <p dir="ltr" style={{whiteSpace:"pre-wrap"}}>{approved.textEn}</p>
        <p dir="rtl" style={{whiteSpace:"pre-wrap"}}>{approved.textAr}</p>
      </div>}
      {!approved && <p className="muted">{tr("No approved report interpretation yet.","لا يوجد تفسير تقرير معتمد بعد.")}</p>}
    </article>
    {canAuthor && <article className="detail-card">
      <h2>{tr("Prepare reviewed draft","إعداد مسودة للمراجعة")}</h2>
      {latest?.status==="DRAFT" ? <p className="muted">{tr("A draft is already awaiting review. No further revision is allowed until it is decided.",
        "توجد مسودة قيد المراجعة. لا يمكن إنشاء مسودة أخرى قبل البتّ فيها.")}</p> :
      <><button type="button" className="primary-button" disabled={busy}
        onClick={()=>{setFormError("");setMessage("");setCreateOpen(true);}}>
        {tr("Create reviewed draft","إنشاء مسودة للمراجعة")}
      </button>
      <CrudModal open={createOpen} onClose={()=>{if(!busy)setCreateOpen(false);}}
        size="compact"
        title={tr("Create Report Interpretation Draft","إنشاء مسودة تفسير التقرير")}
        description={tr(
          "The English and Arabic texts are snapshotted as one immutable draft; a different authorized clinician must review. Issued reports are unaffected.",
          "يُحفظ النصان العربي والإنجليزي كمسودة ثابتة واحدة، ويلزم أن يراجعها طبيب مخوّل آخر؛ التقارير الصادرة لا تتغير.",
        )}>
        {createOpen&&<form className="form-stack" onSubmit={e=>void create(e)}>
        <label>{tr("English interpretation","التفسير بالإنجليزية")}
          <textarea dir="ltr" required maxLength={5000} rows={5}
            value={textEn} onChange={e=>setTextEn(e.target.value)}/></label>
        <label>{tr("Arabic interpretation","التفسير بالعربية")}
          <textarea dir="rtl" required maxLength={5000} rows={5}
            value={textAr} onChange={e=>setTextAr(e.target.value)}/></label>
        <button disabled={busy} className="primary-button">{tr("Create immutable review draft","إنشاء مسودة ثابتة للمراجعة")}</button>
      
        {formError&&<p className="form-error" role="alert">{formError}</p>}
        </form>}
      </CrudModal></>}
    </article>}
    {latest?.status==="DRAFT" && <article className="detail-card">
      <h2>{tr("Pending independent clinical decision","قرار سريري مستقل معلّق")} · v{latest.revisionNumber}</h2>
      <p dir="ltr" style={{whiteSpace:"pre-wrap"}}>{latest.textEn}</p>
      <p dir="rtl" style={{whiteSpace:"pre-wrap"}}>{latest.textAr}</p>
      <small>{tr("Created by","أنشئ بواسطة")}: {latest.createdBy} · {latest.createdAt}</small>
      {canApprove && latest.createdBy!==currentUserId ? <>
        <div className="inline-actions">
          <button disabled={busy} className="primary-button" type="button"
            onClick={()=>openReview("APPROVE")}>
            {tr("Review for approval","المراجعة للاعتماد")}
          </button>
          <button disabled={busy} className="secondary-button" type="button"
            onClick={()=>openReview("REJECT")}>
            {tr("Review for rejection","المراجعة للرفض")}
          </button>
        </div>
      </> : <p className="muted">{tr("A different authorized clinical reviewer must decide.",
        "يجب أن يراجع المسودة شخص مخوّل آخر غير مُنشئها.")}</p>}
    </article>}
    <article className="detail-card">
      <h2>{tr("Immutable comment history","السجل التاريخي الثابت للتعليقات")}</h2>
      {notes.length===0?<p className="muted">{tr("No revisions yet.","لا توجد نسخ بعد.")}</p>:
        notes.map(n=><div key={n.id}>
          <strong>v{n.revisionNumber} · {n.status}</strong>
          <p dir="ltr" style={{whiteSpace:"pre-wrap"}}>{n.textEn}</p>
          <p dir="rtl" style={{whiteSpace:"pre-wrap"}}>{n.textAr}</p>
          {n.reviewReason&&<small>{tr("Review reason","سبب المراجعة")}: {n.reviewReason}</small>}
        </div>)}
    </article>
    {message&&<p role="status" className="form-warning">{message}</p>}
    <CrudModal open={reviewAction!==null} onClose={()=>{if(!busy)setReviewAction(null);}}
      size="compact"
      title={reviewAction==="APPROVE"
        ?tr("Independent Clinical Interpretation Approval","الاعتماد المستقل لتفسير التقرير")
        :tr("Reject Clinical Interpretation Draft","رفض مسودة تفسير التقرير")}
      description={tr(
        "Compare the full English and Arabic texts. Approval applies to future issued report snapshots only, never retroactively.",
        "قارن النصين العربي والإنجليزي كاملاً. ينطبق الاعتماد على لقطات التقارير اللاحقة فقط، وليس بأثر رجعي.",
      )}>
      {reviewAction&&latest&&<form className="form-stack" onSubmit={decide}>
        <strong>{accession} · v{latest.revisionNumber}</strong>
        <p dir="ltr" style={{whiteSpace:"pre-wrap"}}>{latest.textEn}</p>
        <p dir="rtl" style={{whiteSpace:"pre-wrap"}}>{latest.textAr}</p>
        <label>{tr("Clinical review reason (10–1000 characters)","سبب المراجعة السريرية (10–1000 محرف)")}
          <textarea minLength={10} maxLength={1000} required rows={3}
            value={reason} onChange={e=>setReason(e.target.value)}/>
        </label>
        {formError&&<p className="form-error" role="alert">{formError}</p>}
        <button className="primary-button" type="submit"
          disabled={busy||reason.trim().length<10}>
          {reviewAction==="APPROVE"?tr("Confirm exact bilingual text","تأكيد النصين المطابقين")
            :tr("Confirm rejection","تأكيد الرفض")}
        </button>
      </form>}
    </CrudModal>
  </div>;
}
