"use client";
import {useState} from "react";
import {useRouter} from "next/navigation"
import {CrudModal} from "@/components/crud-modal";

export function InventoryLotBranchResponse({lotId,safetyEventId,activeBranchCode,locale,
  canRespond,records}:{
 lotId:string;safetyEventId:string|null;activeBranchCode:string|null;
 locale:"ar"|"en";canRespond:boolean;
 records:Array<{id:string;action:string;note:string;actorName:string;at:string}>;
}){
 const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
 const [action,setAction]=useState("NOTICE_RECEIVED");
 const [note,setNote]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [open,setOpen]=useState(false);
 const router=useRouter();
 async function submit(event: React.FormEvent<HTMLFormElement>){
   event.preventDefault();
   if(!open)return;
   if(!safetyEventId||busy||!canRespond||note.trim().length<20)return;
   setBusy(true);setMessage("");
   try{
     const res=await fetch("/api/inventory/lot-responses",{
       method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({lotId,safetyEventId,action,note:note.trim()}),
     });
     const body=await res.json().catch(()=>({})) as {error?:string};
     if(!res.ok)setMessage(tr("Response rejected: ","تعذر حفظ الاستجابة: ")+(body.error||"unknown"));
     else{setMessage(tr("Branch response recorded.","تم توثيق استجابة الفرع."));setNote("");setOpen(false);router.refresh();}
   }catch{setMessage(tr("Network interrupted. Check the record before retrying.",
     "انقطع الاتصال. راجع السجل قبل إعادة الإرسال."));}
   finally{setBusy(false);}
 }
 return <section className="detail-card detail-section" dir={locale==="ar"?"rtl":"ltr"}>
   <h2>{tr("Branch Safety Response","استجابة الفرع لقرار السلامة")}</h2>
   <p className="muted">{tr(
     "Append-only acknowledgement for the current lot safety decision. Reporting stock isolation is an operator attestation, not an automatic physical inventory verification, clinical exposure determination, or release of a recall.",
     "إقرار محفوظ باستجابة الفرع لقرار السلامة الحالي. تأكيد عزل المخزون هو إقرار الموظف، وليس فحصاً مادياً آلياً أو تحديداً للأثر على المرضى أو رفعاً للسحب."
   )}</p>
   {canRespond&&safetyEventId&&<button type="button" className="primary-button"
    disabled={busy} onClick={()=>{setMessage("");setOpen(true);}}>
    {tr("Record branch response","تسجيل استجابة الفرع")}
   </button>}
   <CrudModal open={open} onClose={()=>{if(!busy)setOpen(false);}}
    size="compact"
    title={tr("Document Branch Lot Safety Response","توثيق استجابة الفرع لسلامة التشغيلة")}
    description={tr(
      "Branch-scoped permanent audit event. Confirming physical isolation is an operator attestation, not actual automated verification. This never releases a held lot.",
      "حدث تدقيق دائم ضمن الفرع. تأكيد العزل إقرار من الموظف وليس تحققاً مادياً آلياً، ولا يرفع حجز التشغيلة.",
    )}>
   {open&&canRespond&&safetyEventId&&<form className="catalog-form" onSubmit={submit}>
     <p>{tr("Active branch","الفرع النشط")}: <strong>{activeBranchCode||"—"}</strong></p>
     <label>{tr("Response type","نوع الاستجابة")}
       <select value={action} onChange={e=>setAction(e.target.value)}>
         <option value="NOTICE_RECEIVED">{tr("Notice received","تم استلام الإشعار")}</option>
         <option value="STOCK_ISOLATED">{tr("Stock isolation confirmed by operator","تأكيد عزل المخزون من الموظف")}</option>
         <option value="ESCALATED_TO_QUALITY">{tr("Escalated to quality management","تم التصعيد لإدارة الجودة")}</option>
       </select>
     </label>
     <label>{tr("Evidence / action notes (20–1000 characters)","ملاحظات الإجراء والأدلة (20–1000 حرف)")}
       <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3}/>
     </label>
     <button type="submit" className="primary-button"
       disabled={busy||note.trim().length<20||!safetyEventId}>{busy?tr("Recording…","جارٍ التسجيل…"):tr("Record branch response","تسجيل استجابة الفرع")}</button>
   {message&&<p className="form-warning" role="alert">{message}</p>}
   </form>}
   </CrudModal>
   {!canRespond&&<p className="muted">{tr(
     "Select an affected, assigned branch and request inventory management access to record a response.",
     "اختر فرعاً متأثراً ومصرحاً لك به، مع صلاحية إدارة المخزون لتسجيل الاستجابة."
   )}</p>}
   {message&&<p role="status" className="form-warning">{message}</p>}
   <div className="table-wrap"><table><thead><tr>
     <th>{tr("Response","الاستجابة")}</th><th>{tr("Recorded by","الموظف")}</th>
     <th>{tr("Recorded at","التاريخ")}</th><th>{tr("Notes","الملاحظات")}</th>
   </tr></thead><tbody>
     {records.map(r=><tr key={r.id}><td>{r.action==="NOTICE_RECEIVED"?tr("Received","استلام"):
       r.action==="STOCK_ISOLATED"?tr("Operator-confirmed isolation","عزل مؤكد من الموظف"):
       tr("Quality escalation","تصعيد للجودة")}</td><td>{r.actorName}</td>
       <td>{r.at.slice(0,19).replace("T"," ")}</td><td>{r.note}</td></tr>)}
     {records.length===0&&<tr><td colSpan={4}>{tr("No branch responses recorded for this decision.",
       "لا توجد استجابات مسجلة لهذا القرار من الفرع.")}</td></tr>}
   </tbody></table></div>
 </section>;
}
