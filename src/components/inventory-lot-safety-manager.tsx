"use client";
import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";

type SafetyStatus="AVAILABLE"|"QUARANTINED"|"RECALLED";
type Action="QUARANTINE"|"RECALL"|"RELEASE";
type Lot={id:string;lotNumber:string;itemCode:string;itemName:string;
  safetyStatus:SafetyStatus;expiryDate:string|null;branches:string[]};
type History={id:string;lotId:string;lotNumber:string;priorStatus:SafetyStatus;
  nextStatus:SafetyStatus;reason:string;at:string;actor:string};
export function InventoryLotSafetyManager({lots,history,locale,canManage}:{
 lots:Lot[];history:History[];locale:"ar"|"en";canManage:boolean;
}){
 const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
 const router=useRouter();
 const [selected,setSelected]=useState(lots[0]?.id||"");
 const [action,setAction]=useState<Action>("QUARANTINE");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const current=useMemo(()=>lots.find(l=>l.id===selected),[lots,selected]);
 const allowed:Action[]=current?.safetyStatus==="AVAILABLE"?["QUARANTINE","RECALL"]:
   current?.safetyStatus==="QUARANTINED"?["RECALL","RELEASE"]:[];
 const choice=allowed.includes(action)?action:allowed[0];
 const label=(s:SafetyStatus)=>({
   AVAILABLE:tr("Available","متاحة"),
   QUARANTINED:tr("Quarantined","محجورة"),
   RECALLED:tr("Recalled — permanent hold","مسحوبة — حجز نهائي"),
 }[s]);
 async function submit(){
   if(!current||!choice||busy)return;
   if(reason.trim().length<20){
     setMessage(tr("Provide a reason of at least 20 characters.","أدخل سببًا واضحًا من 20 حرفًا على الأقل."));return;
   }
   if(!confirm(tr("Record this safety decision for ALL branches? It affects stock availability immediately.",
     "هل تريد اعتماد هذا القرار لجميع الفروع؟ سيؤثر على إمكانية استخدام التشغيلة فورًا.")))return;
   setBusy(true);setMessage("");
   try{
     const response=await fetch("/api/inventory/lot-safety",{
       method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
       body:JSON.stringify({lotId:current.id,action:choice,reason}),
     });
     const data=await response.json().catch(()=>({})) as {error?:string};
     if(!response.ok){
       setMessage(tr("Safety decision rejected: ","تم رفض القرار: ")+(data.error||"unknown"));
     }else{
       setMessage(tr("Safety decision recorded in the audit trail.","تم توثيق قرار السلامة في سجل التدقيق."));
       setReason("");router.refresh();
     }
   }catch{setMessage(tr("Connection interrupted. Verify status before retrying.",
     "انقطع الاتصال. تحقق من الحالة قبل إعادة المحاولة."));}
   finally{setBusy(false);}
 }
 return <section className="detail-card detail-section" dir={locale==="ar"?"rtl":"ltr"}>
   <h2>{tr("Inventory Lot Quarantine & Recall","حجر وسحب تشغيلات المخزون")}</h2>
   <p className="muted">{tr(
     "A safety hold applies organization-wide across branches. Quarantine blocks consumption, transfers, replenishment and linked QC use. A recall is irreversible; restoring quarantined stock requires an independent authorized reviewer.",
     "الحجر يسري على جميع الفروع، ويمنع استهلاك التشغيلة وتحويلها وإعادتها للمخزون واستخدامها في ضبط الجودة المرتبط بها. السحب نهائي، أما رفع الحجر فيتطلب مراجعًا مستقلًا ومخوّلًا."
   )}</p>
   <div className="table-wrap"><table>
     <thead><tr><th>{tr("Lot / item","التشغيلة / الصنف")}</th><th>{tr("State","الحالة")}</th>
       <th>{tr("Visible branches","الفروع المسموحة")}</th><th>{tr("Expiry","انتهاء الصلاحية")}</th></tr></thead>
     <tbody>{lots.length===0?<tr><td colSpan={4}>{tr("No scoped inventory lots.","لا توجد تشغيلات ضمن صلاحياتك.")}</td></tr>:
       lots.map(lot=><tr key={lot.id}>
         <td><strong>{lot.lotNumber}</strong><small> · {lot.itemCode} — {lot.itemName}</small> <Link href={"/inventory/lot-impact/"+lot.id}>{tr("Investigate impact","تحقيق الأثر")}</Link></td>
         <td>{label(lot.safetyStatus)}</td><td>{lot.branches.join(" · ")}</td><td>{lot.expiryDate||"—"}</td>
       </tr>)}</tbody>
   </table></div>
   {canManage&&lots.length>0&&<div className="catalog-form">
     <label>{tr("Select lot","اختر التشغيلة")}
       <select value={selected} onChange={e=>{setSelected(e.target.value);setReason("");setMessage("");}}>
         {lots.map(l=><option key={l.id} value={l.id}>{l.itemCode} · {l.lotNumber} · {label(l.safetyStatus)}</option>)}
       </select></label>
     {allowed.length>0?<label>{tr("Safety decision","قرار السلامة")}
       <select value={choice} onChange={e=>setAction(e.target.value as Action)}>
         {allowed.map(v=><option value={v} key={v}>{v==="QUARANTINE"?tr("Quarantine","حجر"):
           v==="RECALL"?tr("Recall permanently","سحب نهائي"):tr("Independent release","رفع الحجر بمراجعة مستقلة")}</option>)}
       </select></label>:<p>{tr("Recalled lots cannot be released.","التشغيلات المسحوبة نهائيًا لا يمكن إعادة تفعيلها.")}</p>}
     {allowed.length>0&&<>
       <label>{tr("Reason and investigation reference (minimum 20 characters)","السبب ومرجع التحقيق (20 حرفًا على الأقل)")}
         <textarea value={reason} maxLength={1000} rows={3} onChange={e=>setReason(e.target.value)}
           placeholder={tr("Describe manufacturer alert, QC investigation or authorized release decision.",
             "وثّق تحذير المصنع أو تحقيق ضبط الجودة أو سبب السماح برفع الحجر.")} required/></label>
       <button className="primary-button" type="button" disabled={busy||reason.trim().length<20}
         onClick={()=>void submit()}>{busy?tr("Recording…","جارٍ التسجيل…"):tr("Record audited decision","تسجيل قرار مدقّق")}</button>
     </>}
   </div>}
   {message&&<p role="status" className="form-warning">{message}</p>}
   <h3>{tr("Immutable decision history (latest 50)","سجل القرارات المحفوظ (آخر 50)")}</h3>
   <div className="table-wrap"><table>
     <thead><tr><th>{tr("Time","الوقت")}</th><th>{tr("Lot","التشغيلة")}</th>
       <th>{tr("Transition","الانتقال")}</th><th>{tr("Actor","المسؤول")}</th><th>{tr("Reason","السبب")}</th></tr></thead>
     <tbody>{history.length===0?<tr><td colSpan={5}>{tr("No safety events yet.","لا توجد قرارات مسجلة بعد.")}</td></tr>:
       history.map(e=><tr key={e.id}><td>{e.at.slice(0,19).replace("T"," ")}</td>
         <td>{e.lotNumber}</td><td>{label(e.priorStatus)} → {label(e.nextStatus)}</td>
         <td>{e.actor}</td><td>{e.reason}</td></tr>)}</tbody>
   </table></div>
 </section>;
}
