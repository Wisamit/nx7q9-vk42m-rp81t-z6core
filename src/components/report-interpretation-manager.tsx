"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  async function create(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    if(!confirm(tr("Create an immutable draft for independent clinical review? Issued reports never change.",
      "هل تريد إنشاء مسودة ثابتة للمراجعة السريرية المستقلة؟ التقارير الصادرة لن تتغير.")))return;
    setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/reports/interpretations",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderId,textEn,textAr})});
      const data=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok){setMessage(data.error||tr("Unable to save draft.","تعذر حفظ المسودة."));return;}
      setMessage(tr("Draft saved for a separate reviewer.","تم حفظ المسودة للمراجع المستقل."));
      router.refresh();
    }catch{setMessage(tr("Connection failure. Verify before retrying.","فشل الاتصال. تحقق قبل إعادة المحاولة."));}
    finally{setBusy(false);}
  }
  async function decide(decision:"APPROVE"|"REJECT") {
    if(!latest||busy)return;
    const question=decision==="APPROVE"
      ? tr("Have you reviewed BOTH full-language texts? Approve exact text for FUTURE report versions only? Old reports remain unchanged.",
          "هل راجعت النصين كاملين؟ هل تعتمد النص المحدد لإصدارات التقارير المستقبلية فقط؟ التقارير السابقة لا تتغير.")
      : tr("Reject this draft? The decision will be audit logged.","هل ترفض المسودة؟ سيُسجّل القرار في التدقيق.");
    if(!confirm(question))return;
    if(reason.trim().length<10||reason.trim().length>1000) {
      setMessage(tr("A clinical decision reason of 10–1000 characters is required.",
        "يجب كتابة سبب القرار السريري بين 10 و1000 محرف."));return;
    }
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/reports/interpretations",{method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:latest.id,expectedFingerprint:latest.fingerprint,
          decision,reason:reason.trim(),confirmation:decision==="APPROVE"?
          "APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION":null})});
      const data=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok){setMessage(data.error||"Review failed");return;}
      setReason("");
      setMessage(tr("Decision recorded. Previously issued report versions are unchanged.",
        "تم تسجيل القرار؛ إصدارات التقارير السابقة لم تتغير."));
      router.refresh();
    }catch{setMessage(tr("Connection failure. Check status before retrying.",
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
      <form className="form-stack" onSubmit={e=>void create(e)}>
        <label>{tr("English interpretation","التفسير بالإنجليزية")}
          <textarea dir="ltr" required maxLength={5000} rows={5}
            value={textEn} onChange={e=>setTextEn(e.target.value)}/></label>
        <label>{tr("Arabic interpretation","التفسير بالعربية")}
          <textarea dir="rtl" required maxLength={5000} rows={5}
            value={textAr} onChange={e=>setTextAr(e.target.value)}/></label>
        <button disabled={busy} className="primary-button">{tr("Create immutable review draft","إنشاء مسودة ثابتة للمراجعة")}</button>
      </form>}
    </article>}
    {latest?.status==="DRAFT" && <article className="detail-card">
      <h2>{tr("Pending independent clinical decision","قرار سريري مستقل معلّق")} · v{latest.revisionNumber}</h2>
      <p dir="ltr" style={{whiteSpace:"pre-wrap"}}>{latest.textEn}</p>
      <p dir="rtl" style={{whiteSpace:"pre-wrap"}}>{latest.textAr}</p>
      <small>{tr("Created by","أنشئ بواسطة")}: {latest.createdBy} · {latest.createdAt}</small>
      {canApprove && latest.createdBy!==currentUserId ? <>
        <label>{tr("Clinical approval/rejection reason","سبب الاعتماد أو الرفض السريري")}
          <textarea minLength={10} maxLength={1000} required rows={3}
            value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <div className="inline-actions">
          <button disabled={busy} className="primary-button" type="button"
            onClick={()=>void decide("APPROVE")}>{tr("Approve exact bilingual text","اعتماد النصين المحددين")}</button>
          <button disabled={busy} className="secondary-button" type="button"
            onClick={()=>void decide("REJECT")}>{tr("Reject","رفض")}</button>
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
  </div>;
}
