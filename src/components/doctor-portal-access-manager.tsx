"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SelectOption = {id:string;label:string};
type Grant = {id:string;doctor:string;patient:string;orders:boolean;reports:boolean;requestOrders:boolean;
 from:string;to:string|null;status:string;createdBy:string;reason:string;revokedAt:string|null;revokeReason:string|null};
export function DoctorPortalAccessManager({
 locale,doctors,patients,grants,
}:{locale:"ar"|"en";doctors:SelectOption[];patients:SelectOption[];grants:Grant[]}) {
 const t=(en:string,ar:string)=>locale==="ar"?ar:en;
 const router=useRouter();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [doctor,setDoctor]=useState(doctors[0]?.id??""),[patient,setPatient]=useState(patients[0]?.id??"");
 const [orders,setOrders]=useState(true),[reports,setReports]=useState(false);
 const [requestOrders,setRequestOrders]=useState(false);
 const [from,setFrom]=useState(""),[to,setTo]=useState(""),[reason,setReason]=useState("");
 const [after,setAfter]=useState("");
 async function grant(e:React.FormEvent<HTMLFormElement>) {
   e.preventDefault();if(busy||!doctor||!patient)return;
   if(!confirm(t("Grant access to this doctor for this specific patient?","هل تريد منح هذا الطبيب صلاحية الوصول لهذا المريض تحديدًا؟")))return;
   setBusy(true);setMessage("");
   try {
    const r=await fetch("/api/doctor-portal-access",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({referrerId:doctor,patientId:patient,canViewOrders:orders,canViewReports:reports,
       canRequestOrders:requestOrders,
       effectiveFrom:from?new Date(from).toISOString():undefined,
       effectiveTo:to?new Date(to).toISOString():undefined,reason})});
    const data=await r.json().catch(()=>({})) as {error?:string};
    if(!r.ok)setMessage(t("Grant failed: ","فشل منح الصلاحية: ")+(data.error??"unknown"));
    else{setMessage(t("Access granted and audited.","تم منح الصلاحية وتوثيقها."));setReason("");router.refresh();}
   }catch{setMessage(t("Connection failed; verify state before retry.","فشل الاتصال، تحقق من حالة الصلاحية قبل الإعادة."));}
   finally{setBusy(false);}
 }
 async function revoke(id:string) {
   const r=prompt(t("Why is this access being revoked? (10–1000 characters)","سبب إلغاء الصلاحية (10–1000 محرف)"));
   if(r===null)return;
   if(r.trim().length<10||r.trim().length>1000){setMessage(t("A detailed reason is required.","سبب واضح إلزامي."));return;}
   if(!confirm(t("Immediately revoke this doctor's access to this patient?","هل تريد إلغاء وصول الطبيب لهذا المريض فورًا؟")))return;
   setBusy(true);setMessage("");
   try {
    const response=await fetch("/api/doctor-portal-access",{method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({id,reason:r})});
    const body=await response.json().catch(()=>({})) as {error?:string};
    setMessage(response.ok?t("Access revoked and audited.","تم إلغاء الصلاحية وتوثيقها."):
     t("Revocation failed: ","فشل الإلغاء: ")+(body.error??"unknown"));
    if(response.ok)router.refresh();
   }catch{setMessage(t("Connection failed; check before retrying.","فشل الاتصال، تحقق قبل إعادة المحاولة."));}
   finally{setBusy(false);}
 }
 const visible=grants.filter(x=>!after||x.id>after).slice(0,50);
 return <div className="detail-grid">
  <article className="detail-card">
    <h2>{t("Grant scoped clinical access","منح صلاحية الوصول الطبي")}</h2>
    <p className="muted">{t(
     "A referral alone does not authorize access. Link a doctor to each patient explicitly. Reports need a separate authorization.",
     "الإحالة وحدها لا تسمح بالوصول. اربط الطبيب بكل مريض صراحةً، مع صلاحية مستقلة لعرض التقارير.")}</p>
    <form className="form-stack" onSubmit={e=>void grant(e)}>
      <label>{t("Doctor portal account","حساب بوابة الطبيب")}
       <select required value={doctor} onChange={e=>setDoctor(e.target.value)}>
        {doctors.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
       </select></label>
      <label>{t("Patient","المريض")}<select required value={patient} onChange={e=>setPatient(e.target.value)}>
       {patients.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label><input type="checkbox" checked={orders} onChange={e=>setOrders(e.target.checked)}/>
       {t("Allow laboratory orders","السماح بعرض طلبات المختبر")}</label>
      <label><input type="checkbox" checked={reports} onChange={e=>setReports(e.target.checked)}/>
       {t("Allow released diagnostic reports","السماح بعرض التقارير الصادرة")}</label>
      <label><input type="checkbox" checked={requestOrders} onChange={e=>setRequestOrders(e.target.checked)}/>
       {t("Allow new electronic test requisitions", "السماح بطلب فحوصات إلكترونيًا")}</label>
      <label>{t("Effective from (leave blank for now)","يبدأ السريان (اترك فارغًا للآن)")}
       <input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>{t("Effective until (optional)","ينتهي السريان (اختياري)")}
       <input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label>
      <label>{t("Authorization reason (10–1000 chars)","سبب التفويض (10–1000 محرف)")}
       <textarea required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className="primary-button" disabled={busy||!doctor||!patient||(!orders&&!reports&&!requestOrders)}>
       {busy?t("Saving…","جارٍ الحفظ…"):t("Grant doctor access","منح الطبيب الصلاحية")}
      </button>
    </form>
  </article>
  <article className="detail-card">
   <h2>{t("Authorization register","سجل تفويض الأطباء")}</h2>
   {message&&<p role="status">{message}</p>}
   <div className="table-wrap"><table><thead><tr>
     <th>{t("Doctor / patient","الطبيب / المريض")}</th>
     <th>{t("Allowed","الصلاحيات")}</th><th>{t("Dates / status","السريان / الحالة")}</th>
     <th>{t("Actions","الإجراءات")}</th>
    </tr></thead><tbody>{visible.map(g=><tr key={g.id}>
     <td>{g.doctor}<small className="table-subtext">{g.patient}</small>
      <small className="table-subtext">{g.reason}</small></td>
     <td>{g.orders?t("Orders ","طلبات "):""}{g.reports?t("Reports ","تقارير "):""}{g.requestOrders?t("Electronic requisitions","طلبات إلكترونية"):""}</td>
     <td>{g.status}<small className="table-subtext">{g.from} — {g.to||"∞"}</small>
      {g.revokeReason&&<small className="table-subtext">{g.revokeReason}</small>}</td>
     <td>{g.status==="ACTIVE"&&<button className="secondary-button" type="button"
       disabled={busy} onClick={()=>void revoke(g.id)}>{t("Revoke","إلغاء")}</button>}</td>
    </tr>)}</tbody></table></div>
   {grants.length>50&&visible.length===50&&<button type="button" className="secondary-button"
     onClick={()=>setAfter(visible[49].id)}>{t("Next page","الصفحة التالية")}</button>}
  </article>
 </div>;
}
