"use client";
import {useState, type FormEvent} from "react";
import {useRouter} from "next/navigation";

export function RecallQualityCaseManager({lotId,safetyEventId,canCreate,
 caseNumber,locale}:{
 lotId:string;safetyEventId:string|null;canCreate:boolean;caseNumber:string|null;locale:"ar"|"en";
}){
 const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
 const router=useRouter();
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!safetyEventId||!canCreate||busy)return;
  const form=new FormData(e.currentTarget);
  if(!confirm(tr(
   "Open a branch-specific nonconformance from this confirmed recall escalation? This is not evidence of patient exposure.",
   "فتح قضية عدم مطابقة خاصة بهذا الفرع من تصعيد السحب المسجل؟ هذا لا يُعد إثباتاً لتعرّض المرضى."
  )))return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/inventory/lot-quality-cases",{
    method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
    body:JSON.stringify({lotId,safetyEventId,title:form.get("title"),
      description:form.get("description"),severity:form.get("severity")}),
   });
   const body=await response.json().catch(()=>({})) as {error?:string;
    nonconformance?:{caseNumber:string}};
   if(!response.ok){setMessage(tr("Request refused: ","رُفض الطلب: ")+(body.error||"unknown"));return;}
   setMessage(tr("Quality case created: ","تم فتح قضية جودة: ")+body.nonconformance?.caseNumber);
   router.refresh();
  }catch{setMessage(tr("Unable to contact the server.","تعذر الاتصال بالخادم."));}
  finally{setBusy(false);}
 }
 return <section className="detail-card detail-section" dir={locale==="ar"?"rtl":"ltr"}>
  <h2>{tr("Linked quality nonconformance","قضية عدم المطابقة المرتبطة")}</h2>
  <p className="muted">{tr(
   "An inventory recall escalation can open a separately governed quality investigation. Creating a case never lifts the lot hold or alters patient results, released reports or financial records.",
   "يمكن لتصعيد سحب دفعة مخزون أن يفتح تحقيق جودة مستقلاً. فتح القضية لا يلغي حجز الدفعة ولا يغيّر نتائج المرضى أو التقارير الصادرة أو السجلات المالية."
  )}</p>
  {caseNumber?<p><strong>{tr("Existing case","القضية الحالية")}: {caseNumber}</strong></p>
   :canCreate&&safetyEventId?<form className="catalog-form" onSubmit={e=>void submit(e)}>
    <label>{tr("Investigation title","عنوان التحقيق")}
     <input name="title" minLength={15} maxLength={255} required/></label>
    <label>{tr("Severity selected by quality staff","الشدة التي يحددها موظف الجودة")}
     <select name="severity" required defaultValue=""><option value="">{tr("Select…","اختر…")}</option>
      <option value="MAJOR">{tr("Major","كبيرة")}</option>
      <option value="CRITICAL">{tr("Critical","حرجة")}</option></select></label>
    <label>{tr("Documented investigation context (at least 30 characters)","سياق التحقيق الموثق (30 حرفًا على الأقل)")}
     <textarea name="description" minLength={30} maxLength={5000} rows={4} required/></label>
    <button type="submit" className="primary-button" disabled={busy}>{busy?tr("Opening…","جارٍ الفتح…"):
     tr("Open governed nonconformance","فتح قضية عدم مطابقة مضبوطة")}</button>
   </form>:<p>{tr(
    "To open a case, an authorized branch must first record ESCALATED_TO_QUALITY for the current lot safety event and have quality nonconformance management permission.",
    "لفتح قضية، يجب أن يسجّل الفرع المخوّل أولاً تصعيدًا للجودة عن آخر واقعة سلامة للتشغيلة وأن يمتلك صلاحية إدارة عدم المطابقة."
   )}</p>}
  {message&&<p role="status" className="form-warning">{message}</p>}
 </section>;
}
