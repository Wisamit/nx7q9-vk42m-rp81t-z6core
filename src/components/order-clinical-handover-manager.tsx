"use client";
import { SystemDateText } from "@/components/system-date-text";
import { useState } from "react";
import { useRouter } from "next/navigation"
import { CrudModal } from "@/components/crud-modal";
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
 const [editorOpen,setEditorOpen]=useState(false);
 const [pendingAction,setPendingAction]=useState<{noteId:string;action:"ACKNOWLEDGE"|"RETRACT"}|null>(null);
 const [retractionReason,setRetractionReason]=useState("");
 const [actionError,setActionError]=useState("");
 const pendingCorrection=notes.find(x=>x.id===replacesNoteId);
 function beginCorrection(note:Note) {
   setCategory(note.category);setLanguage(note.language==="ar"?"ar":"en");
   setBody(note.body);setRequiresAcknowledgement(note.requiresAcknowledgement);
   setReplacesNoteId(note.id);setCorrectionReason("");
   setClientRequestId(crypto.randomUUID());setNotice("");
   setEditorOpen(true);
 }
 function reset() {
   setCategory("CLINICAL_CONTEXT");setLanguage(locale);setBody("");
   setRequiresAcknowledgement(false);setReplacesNoteId(null);
   setCorrectionReason("");setClientRequestId(crypto.randomUUID());
 }
 async function submit(event:React.FormEvent<HTMLFormElement>) {
   event.preventDefault();if(busy||!canWrite||!activeBranch)return;
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
     setEditorOpen(false);reset();setNotice(tr("Entry saved and audited.","تم حفظ الملاحظة وتوثيقها."));router.refresh();
   }catch{
     setNotice(tr("Connection interrupted; retry preserves the same request identifier.",
       "انقطع الاتصال، وإعادة المحاولة تستخدم معرّف العملية نفسه."));
   }finally{setBusy(false);}
 }
 function askAction(noteId:string,action:"ACKNOWLEDGE"|"RETRACT") {
   if(busy||!activeBranch)return;
   const note=notes.find(item=>item.id===noteId);
   if(!note||note.status!=="ACTIVE")return;
   setNotice("");setActionError("");setRetractionReason("");
   setPendingAction({noteId,action});
 }
 async function action(event:React.FormEvent<HTMLFormElement>) {
   event.preventDefault();
   if(!pendingAction||busy||!activeBranch)return;
   const {noteId,action:operation}=pendingAction;
   const note=notes.find(item=>item.id===noteId);
   if(!note||note.status!=="ACTIVE"){
     setActionError(tr("This revision is no longer active.","هذه النسخة لم تعد فعالة."));return;
   }
   const reason=operation==="RETRACT"?retractionReason.trim():null;
   if(operation==="RETRACT"&&(!reason||reason.length<10||reason.length>1000)){
     setActionError(tr("Retraction requires a 10–1000 character documented reason.",
       "يتطلب السحب سبباً موثقاً من 10 إلى 1000 محرف."));return;
   }
   setBusy(true);setActionError("");
   try{
     const r=await fetch(`/api/orders/${orderId}/clinical-handover`,{
       method:"PATCH",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({noteId,action:operation,reason}),
     });
     const x=await r.json().catch(()=>({})) as {error?:string};
     if(!r.ok){
       setActionError(tr("Action rejected: ","تم رفض الإجراء: ")+(x.error||"unknown"));return;
     }
     setPendingAction(null);
     setNotice(tr("Action recorded.","تم توثيق الإجراء."));
     router.refresh();
   }catch{setActionError(tr("Connection interrupted; review state before retrying.",
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
     {canWrite&&activeBranch&&<button type="button" className="primary-button" disabled={busy}
       onClick={()=>{reset();setNotice("");setEditorOpen(true);}}>
       {tr("Add clinical handover note","إضافة ملاحظة تسليم سريري")}
     </button>}
     <CrudModal open={editorOpen} onClose={()=>{if(!busy)setEditorOpen(false);}}
       size="compact"
       title={pendingCorrection?tr("Correct Clinical Handover Revision","تصحيح نسخة تسليم سريري"):
         tr("Add Clinical Handover Note","إضافة ملاحظة تسليم سريري")}
       description={tr(
         "Append-only staff clinical record. Corrections create a new revision and retain previous text; no released result, report or invoice is overwritten.",
         "سجل سريري داخلي إضافي فقط؛ ينشئ التصحيح نسخة جديدة ويحافظ على النص السابق دون استبدال نتيجة صادرة أو تقرير أو فاتورة.",
       )}>
     {editorOpen&&canWrite&&activeBranch&&<form className="form-stack" onSubmit={e=>void submit(e)}>
       <label>{tr("Category","التصنيف")}
         <select value={category} onChange={e=>setCategory(e.target.value)}>
           {Object.entries(categoryNames).map(([code,title])=><option key={code} value={code}>
             {tr(title[0],title[1])}</option>)}
         </select></label>
       <label>{tr("Content language","لغة الملاحظة")}
         <select value={language} onChange={e=>setLanguage(e.target.value as "en"|"ar")}>
           <option value="en">{tr("English","الإنجليزية")}</option><option value="ar">{tr("Arabic","العربية")}</option>
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
         {pendingCorrection&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>{reset();setEditorOpen(false);}}>
           {tr("Cancel correction","إلغاء التصحيح")}</button>}
       </div>
     {notice&&<p role="status" className="form-warning">{notice}</p>}
     </form>}
     </CrudModal>
     {notice&&<p role="status" className="form-warning">{notice}</p>}
   </article>
   <article className="detail-card">
     <h2>{tr("Full clinical handover timeline (this page)","سجل التسليم السريري (هذه الصفحة)")}</h2>
     {notes.length===0&&<p className="muted">{tr("No clinical handover revisions yet.","لا توجد ملاحظات سريرية بعد.")}</p>}
     {notes.map(note=><div key={note.id} className="detail-section">
       <strong>{tr(categoryNames[note.category]?.[0]||note.category,categoryNames[note.category]?.[1]||note.category)}
         {" · "}v{note.revisionNumber} · {note.status}</strong>
       <small className="table-subtext">{note.authorName} · {<SystemDateText value={note.createdAt} />}</small>
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
            onClick={()=>askAction(note.id,"ACKNOWLEDGE")}>{tr("Acknowledge","تأكيد الاطلاع")}</button>}
         {note.status==="ACTIVE"&&activeBranch&&canWrite&&
          (note.createdByUserId===currentUserId||canCorrectOthers)&&<>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={()=>beginCorrection(note)}>{tr("Correct","تصحيح")}</button>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={()=>askAction(note.id,"RETRACT")}>{tr("Retract","سحب")}</button>
         </>}
       </div>
     </div>)}
   </article>
   <CrudModal open={pendingAction!==null} onClose={()=>{if(!busy)setPendingAction(null);}}
     size="compact"
     title={pendingAction?.action==="RETRACT"
       ?tr("Retract Clinical Handover Revision","سحب نسخة تسليم سريري")
       :tr("Acknowledge Clinical Handover Revision","تأكيد قراءة نسخة تسليم سريري")}
     description={tr(
       "This action applies to one exact active revision. Original text, previous revisions, authors and the audit history remain permanently traceable.",
       "يطبّق هذا الإجراء على نسخة فعالة واحدة محددة، وتظل النصوص والنسخ السابقة ومؤلفوها وسجل التدقيق محفوظة وقابلة للتتبع.",
     )}>
     {pendingAction&&<form className="form-stack" onSubmit={e=>void action(e)}>
       {(() => {
         const target=notes.find(x=>x.id===pendingAction.noteId);
         if(!target)return <p className="form-error" role="alert">{tr("Revision unavailable.","النسخة غير متاحة.")}</p>;
         return <div className="detail-section">
           <strong>{tr("Revision","النسخة")} v{target.revisionNumber} · {target.authorName}</strong>
           <p dir={target.language==="ar"?"rtl":"ltr"} style={{whiteSpace:"pre-wrap"}}>
             {target.body}
           </p>
         </div>;
       })()}
       {pendingAction.action==="RETRACT"&&<label>
         {tr("Retraction reason (10–1000 characters)","سبب سحب الملاحظة (10–1000 محرف)")}
         <textarea rows={3} required minLength={10} maxLength={1000}
           value={retractionReason} onChange={e=>setRetractionReason(e.target.value)}/>
       </label>}
       {actionError&&<p className="form-error" role="alert">{actionError}</p>}
       <button type="submit" className="primary-button" disabled={busy||
         (pendingAction.action==="RETRACT"&&retractionReason.trim().length<10)}>
         {pendingAction.action==="RETRACT"?tr("Confirm retraction","تأكيد السحب"):
           tr("Confirm reading this revision","تأكيد قراءة هذه النسخة")}
       </button>
     </form>}
   </CrudModal>
 </div>;
}
