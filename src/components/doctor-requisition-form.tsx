"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Choice={id:string;label:string};
type TestChoice=Choice&{code:string};
type RequestItem={id:string;status:string;submittedAt:string;priority:string;
  branchLabel:string;patientLabel:string;testNames:string[];orderId:string|null};
export function DoctorRequisitionForm({locale,patients,branches,tests,requests}:{
  locale:"ar"|"en";patients:Choice[];branches:Choice[];tests:TestChoice[];
  requests:RequestItem[];
}) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const router=useRouter();
  const [patientId,setPatientId]=useState(patients[0]?.id??"");
  const [branchId,setBranchId]=useState(branches[0]?.id??"");
  const [priority,setPriority]=useState("ROUTINE");
  const [testIds,setTestIds]=useState<string[]>([]);
  const [diagnosis,setDiagnosis]=useState("");
  const [clinicalNotes,setClinicalNotes]=useState("");
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy||!patientId||!branchId||testIds.length===0)return;
    if(!confirm(tr("Submit an electronic test requisition for staff review? No laboratory order or invoice will be created yet.",
      "إرسال طلب فحوصات إلكتروني لمراجعة الاستقبال؟ لن يُنشأ طلب مخبري أو فاتورة الآن.")))return;
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/portal/doctor-requisitions",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({clientRequestId:requestKey,patientId,branchId,
          priority,testIds,diagnosis,clinicalNotes}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) {setMessage(tr("Request not accepted: ","لم يتم قبول الطلب: ")+(body.error||"unknown"));return;}
      setMessage(tr("Requisition recorded for reception review.","تم تسجيل الإحالة لمراجعة الاستقبال."));
      setRequestKey(crypto.randomUUID());setTestIds([]);setDiagnosis("");setClinicalNotes("");
      router.refresh();
    }catch{setMessage(tr("Connection interrupted; retry uses the same request ID.",
      "انقطع الاتصال؛ إعادة المحاولة تستخدم نفس معرّف الطلب."));}
    finally{setBusy(false);}
  }
  async function cancel(id:string){
    if(busy||!confirm(tr("Cancel this pending requisition?","إلغاء الإحالة المعلّقة؟")))return;
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/portal/doctor-requisitions",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id})});
      const data=await r.json().catch(()=>({})) as {error?:string};
      setMessage(r.ok?tr("Pending request cancelled.","تم إلغاء الطلب المعلّق."):
        tr("Cancellation failed: ","فشل الإلغاء: ")+(data.error||"unknown"));
      if(r.ok)router.refresh();
    }catch{setMessage(tr("Connection failure; check request status.","انقطع الاتصال؛ تحقق من حالة الطلب."));}
    finally{setBusy(false);}
  }
  return <section className="detail-grid" dir={locale==="ar"?"rtl":"ltr"}>
    <article className="detail-card">
      <h2>{tr("Electronic laboratory requisition","طلب فحوصات مخبرية إلكتروني")}</h2>
      <p className="muted">{tr("Only explicitly authorized patients can be selected. A laboratory employee must review, price and register the order separately.",
        "تظهر فقط أسماء المرضى المفوّضين صراحةً. يجب على موظف المختبر مراجعة الطلب وتسعيره وتسجيله بشكل مستقل.")}</p>
      <form className="form-stack" onSubmit={e=>void submit(e)}>
        <label>{tr("Authorized patient","المريض المفوّض")}
          <select required value={patientId} onChange={e=>setPatientId(e.target.value)}>
            {patients.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}
          </select></label>
        <label>{tr("Receiving branch","فرع الاستقبال")}
          <select required value={branchId} onChange={e=>setBranchId(e.target.value)}>
            {branches.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>{tr("Requested priority","أولوية الطلب")}
          <select value={priority} onChange={e=>setPriority(e.target.value)}>
            <option value="ROUTINE">{tr("Routine","عادي")}</option>
            <option value="URGENT">{tr("Urgent","عاجل")}</option>
            <option value="STAT">{tr("STAT","فوري")}</option></select></label>
        <label>{tr("Clinical indication","الدلالة السريرية")}
          <input maxLength={500} value={diagnosis} onChange={e=>setDiagnosis(e.target.value)}/></label>
        <label>{tr("Clinical notes","ملاحظات سريرية")}
          <textarea maxLength={5000} rows={3} value={clinicalNotes} onChange={e=>setClinicalNotes(e.target.value)}/></label>
        <div className="form-stack">
          <strong>{tr("Requested tests (maximum 25)","الفحوصات المطلوبة (حد أقصى 25)")}</strong>
          <div className="table-wrap" style={{maxHeight:220,overflowY:"auto"}}>
            {tests.map(test=><label key={test.id} style={{display:"block"}}>
              <input type="checkbox" checked={testIds.includes(test.id)} disabled={!testIds.includes(test.id)&&testIds.length>=25}
                onChange={e=>setTestIds(prev=>e.target.checked?[...prev,test.id]:prev.filter(x=>x!==test.id))}/>
              {test.code} — {test.label}
            </label>)}
          </div>
          <small>{testIds.length} {tr("selected","مختار")}</small>
        </div>
        <button className="primary-button" disabled={busy||!patientId||!branchId||testIds.length===0}>
          {busy?tr("Submitting…","جارٍ الإرسال…"):tr("Submit for lab review","إرسال لمراجعة المختبر")}</button>
        {message&&<p role="status">{message}</p>}
      </form>
    </article>
    <article className="detail-card">
      <h2>{tr("Recent requisitions","الإحالات الحديثة")}</h2>
      <div className="table-wrap"><table><thead><tr>
        <th>{tr("Patient / branch","المريض / الفرع")}</th>
        <th>{tr("Tests / priority","الفحوصات / الأولوية")}</th>
        <th>{tr("Status","الحالة")}</th><th>{tr("Action","الإجراء")}</th>
      </tr></thead><tbody>{requests.map(r=><tr key={r.id}>
        <td>{r.patientLabel}<small className="table-subtext">{r.branchLabel} · {r.submittedAt.slice(0,16)}</small></td>
        <td>{r.testNames.join(", ")}<small className="table-subtext">{r.priority}</small></td>
        <td>{r.status}</td>
        <td>{r.status==="SUBMITTED"&&<button type="button" className="secondary-button" disabled={busy}
          onClick={()=>void cancel(r.id)}>{tr("Cancel","إلغاء")}</button>}</td>
      </tr>)}</tbody></table></div>
      {requests.length===0&&<p className="muted">{tr("No authorized requisitions yet.","لا توجد إحالات مفوّضة بعد.")}</p>}
    </article>
  </section>;
}
