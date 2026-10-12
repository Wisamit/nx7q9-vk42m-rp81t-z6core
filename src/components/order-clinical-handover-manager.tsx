"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Note = {
  id:string; threadId:string; revisionNumber:number; category:string; language:string;
  body:string; status:string; requiresAcknowledgement:boolean;
  createdByUserId:string; authorName:string; createdAt:string;
  correctionReason:string|null; retirementReason:string|null;
  replacesNoteId:string|null; acknowledgementCount:number; acknowledgedByMe:boolean;
};
const categoryNames:Record<string,[string,string]>={
  CLINICAL_CONTEXT:["Clinical context","سياق سريري"],
  COLLECTION_INSTRUCTION:["Collection instruction","تعليمات سحب العينة"],
  LAB_HANDOVER:["Laboratory handover","تسليم لقسم المختبر"],
  QUALITY_CAUTION:["Quality caution","تنبيه جودة"],
};
export function OrderClinicalHandoverManager({locale,orderId,notes,currentUserId,
 canWrite,canCorrectOthers,activeBranch}:{
 locale:"en"|"ar";orderId:string;notes:Note[];currentUserId:string;
 canWrite:boolean;canCorrectOthers:boolean;activeBranch:boolean;
}) {
 const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
 const router=useRouter();
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [clientRequestId,setClientRequestId]=useState(()=>crypto.randomUUID());
 const [category,setCategory]=useState("CLINICAL_CONTEXT");
 const [language,setLanguage]=useState<"en"|"ar">(locale);
 const [body,setBody]=useState("");
 const [requiresAcknowledgement,setRequiresAcknowledgement]=useState(false);
 const [replacesNoteId,setReplacesNoteId]=useState<string|null>(null);
 const [correctionReason,setCorrectionReason]=useState("");
 const pendingCorrection=notes.find(x=>x.id===replacesNoteId);
 function beginCorrection(note:Note) {
   setCategory(note.category);setLanguage(note.language==="ar"?"ar":"en");
   setBody(note.body);setRequiresAcknowledgement(note.requiresAcknowledgement);
   setReplacesNoteId(note.id);setCorrectionReason("");
   setClientRequestId(crypto.randomUUID());setNotice("");
   document.getElementById("clinical-handover-editor")?.scrollIntoView({behavior:"smooth"});
 }
 function reset() {
   setCategory("CLINICAL_CONTEXT");setLanguage(locale);setBody("");
   setRequiresAcknowledgement(false);setReplacesNoteId(null);
   setCorrectionReason("");setClientRequestId(crypto.randomUUID());
 }
 async function submit(event:React.FormEvent<HTMLFormElement>) {
   event.preventDefault();if(busy||!canWrite||!activeBranch)return;
   if(!confirm(tr(
     "Save this staff-only clinical handover entry? Historical clinical text will be preserved.",
     "حفظ هذه الملاحظة السريرية الداخلية؟ سيُحفظ النص التاريخي دون حذف."
   )))return;
   setBusy(true);setNotice("");
   try {
     const response=await fetch(`/api/orders/${orderId}/clinical-handover`,{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({clientRequestId,category,language,body,
         requiresAcknowledgement,replacesNoteId,
         correctionReason:replacesNoteId?correctionReason:null}),
     });
     const data=await response.json().catch(()=>({})) as {error?:string};
     if(!response.ok){setNotice(tr("Unable to save: ","تعذر الحفظ: ")+(data.error||"unknown"));return;}
     reset();setNotice(tr("Entry saved and audited.","تم حفظ الملاحظة وتوثيقها."));router.refresh();
   }catch{
     setNotice(tr("Connection interrupted; retry preserves the same request identifier.",
       "انقطع الاتصال، وإعادة المحاولة تستخدم معرّف العملية نفسه."));
   }finally{setBusy(false);}
 }
 async function action(noteId:string,action:"ACKNOWLEDGE"|"RETRACT") {
   if(busy||!activeBranch)return;
   let reason:string|null=null;
   if(action==="RETRACT") {
     reason=prompt(tr("Retraction reason (10–1000 characters):",
       "سبب سحب الملاحظة (10–1000 حرف):"));
     if(reason===null)return;
     if(reason.trim().length<10||reason.trim().length>1000) {
       setNotice(tr("Detailed retraction reason required.","سبب تفصيلي مطلوب لسحب الملاحظة."));return;
     }
   }
   if(!confirm(action==="RETRACT"
     ?tr("Retract this note while preserving its original text and audit?",
       "سحب الملاحظة مع الحفاظ على النص والتدقيق؟")
     :tr("Acknowledge reading this exact active revision?","تأكيد الاطلاع على هذه النسخة الحالية؟")))return;
   setBusy(true);setNotice("");
   try{
     const r=await fetch(`/api/orders/${orderId}/clinical-handover`,{
       method:"PATCH",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({noteId,action,reason}),
     });
     const x=await r.json().catch(()=>({})) as {error?:string};
     setNotice(r.ok?tr("Action recorded.","تم توثيق الإجراء."):
       tr("Action rejected: ","تم رفض الإجراء: ")+(x.error||"unknown"));
     if(r.ok)router.refresh();
   }catch{setNotice(tr("Connection interrupted; review state before retrying.",
       "انقطع الاتصال؛ تحقق من الحالة قبل إعادة الإجراء."));}
   finally{setBusy(false);}
 }
 return <div className="detail-grid" dir={locale==="ar"?"rtl":"ltr"}>
   <article className="detail-card" id="clinical-handover-editor">
     <h2>{pendingCorrection?tr("Correct active annotation","تصحيح الملاحظة الحالية"):
       tr("New order-level clinical annotation","ملاحظة سريرية جديدة للطلب")}</h2>
     <p className="muted">{tr("Staff-only operational handover. This is NOT a released report interpretation; it does not modify results, invoices or issued reports.",
       "تسليم تشغيلي داخلي للموظفين فقط. ليست تفسيرًا للتقرير المعتمد ولا تعدّل النتائج أو الفواتير أو التقارير الصادرة.")}</p>
     {(!canWrite||!activeBranch)&&<p className="form-warning">{tr(
       "To write, activate the ordering branch and obtain Orders Create permission.",
       "لإضافة ملاحظة يجب تفعيل فرع الطلب والحصول على صلاحية إنشاء الطلبات."
     )}</p>}
     {canWrite&&activeBranch&&<form className="form-stack" onSubmit={e=>void submit(e)}>
       <label>{tr("Category","التصنيف")}
         <select value={category} onChange={e=>setCategory(e.target.value)}>
           {Object.entries(categoryNames).map(([code,title])=><option key={code} value={code}>
             {tr(title[0],title[1])}</option>)}
         </select></label>
       <label>{tr("Content language","لغة الملاحظة")}
         <select value={language} onChange={e=>setLanguage(e.target.value as "en"|"ar")}>
           <option value="en">English</option><option value="ar">العربية</option>
         </select></label>
       <label>{tr("Clinical handover text (2–4000 characters)","نص الملاحظة (2–4000 حرف)")}
         <textarea required minLength={2} maxLength={4000} rows={6} dir={language==="ar"?"rtl":"ltr"}
           value={body} onChange={e=>setBody(e.target.value)}/></label>
       <label><input type="checkbox" checked={requiresAcknowledgement}
         onChange={e=>setRequiresAcknowledgement(e.target.checked)}/>
         {tr("Require explicit reading acknowledgement by another authorized staff member",
           "تأكيد قراءة إلزامي من موظف مخوّل آخر")}</label>
       {pendingCorrection&&<label>{tr("Correction reason (required)","سبب التصحيح (إلزامي)")}
         <textarea required minLength={10} maxLength={1000} rows={2}
           value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)}/></label>}
       <div className="inline-actions">
         <button type="submit" className="primary-button" disabled={busy||body.trim().length<2}>
           {tr(pendingCorrection?"Save new historical revision":"Add immutable clinical note",
             pendingCorrection?"حفظ نسخة مصحّحة":"إضافة ملاحظة محفوظة")}</button>
         {pendingCorrection&&<button type="button" className="secondary-button" disabled={busy} onClick={reset}>
           {tr("Cancel correction","إلغاء التصحيح")}</button>}
       </div>
     </form>}
     {notice&&<p role="status" className="form-warning">{notice}</p>}
   </article>
   <article className="detail-card">
     <h2>{tr("Full clinical handover timeline (this page)","سجل التسليم السريري (هذه الصفحة)")}</h2>
     {notes.length===0&&<p className="muted">{tr("No clinical handover revisions yet.","لا توجد ملاحظات سريرية بعد.")}</p>}
     {notes.map(note=><div key={note.id} className="detail-section">
       <strong>{tr(...(categoryNames[note.category]??[note.category,note.category]))}
         {" · "}v{note.revisionNumber} · {note.status}</strong>
       <small className="table-subtext">{note.authorName} · {note.createdAt.replace("T"," ").slice(0,19)}</small>
       <p dir={note.language==="ar"?"rtl":"ltr"} style={{whiteSpace:"pre-wrap"}}>{note.body}</p>
       {note.correctionReason&&<small className="table-subtext">
         {tr("Correction reason","سبب التصحيح")}: {note.correctionReason}</small>}
       {note.retirementReason&&<small className="table-subtext">
         {tr("Retirement reason","سبب إنهاء النسخة")}: {note.retirementReason}</small>}
       {note.replacesNoteId&&<small className="table-subtext">
         {tr("Replaces historical revision","يستبدل النسخة التاريخية")}: {note.replacesNoteId.slice(0,8)}</small>}
       {note.requiresAcknowledgement&&<small className="table-subtext">
         {tr("Acknowledgements","تأكيدات الاطلاع")}: {note.acknowledgementCount}
         {note.acknowledgedByMe?tr(" (acknowledged by you)"," (أكّدت الاطلاع)"):null}</small>}
       <div className="inline-actions">
         {note.status==="ACTIVE"&&activeBranch&&note.requiresAcknowledgement&&
          note.createdByUserId!==currentUserId&&!note.acknowledgedByMe&&
          <button type="button" className="secondary-button" disabled={busy}
            onClick={()=>void action(note.id,"ACKNOWLEDGE")}>{tr("Acknowledge","تأكيد الاطلاع")}</button>}
         {note.status==="ACTIVE"&&activeBranch&&canWrite&&
          (note.createdByUserId===currentUserId||canCorrectOthers)&&<>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={()=>beginCorrection(note)}>{tr("Correct","تصحيح")}</button>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={()=>void action(note.id,"RETRACT")}>{tr("Retract","سحب")}</button>
         </>}
       </div>
     </div>)}
   </article>
 </div>;
}
