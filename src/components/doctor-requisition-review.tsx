"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";
type Row={id:string;status:string;submittedAt:string;branchTimeZone:string;patient:string;
  branch:string;doctor:string;priority:string;tests:string[];
  diagnosis:string|null;clinicalNotes:string|null;fulfilledOrderId:string|null;
  resolutionReason:string|null};
export function DoctorRequisitionReview({locale,rows}:{locale:"ar"|"en";rows:Row[]}) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const router=useRouter();
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [decliningId,setDecliningId]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  async function decline(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!decliningId||busy)return;
    const decisionReason=reason.trim();
    if(decisionReason.length<10||decisionReason.length>1000) {
      setNotice(tr("A detailed reason is required.","السبب التفصيلي إلزامي."));return;
    }
    setBusy(true);setNotice("");
    try{
      const r=await fetch("/api/doctor-requisitions/review",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:decliningId,decision:"DECLINE",reason:decisionReason}),
      });
      const data=await r.json().catch(()=>({})) as {error?:string};
      setNotice(r.ok?tr("Decision logged.","تم توثيق القرار."):
        tr("Unable to decline: ","تعذر الرفض: ")+(data.error||"unknown"));
      if(r.ok){setDecliningId(null);setReason("");router.refresh();}
    }catch{setNotice(tr("Connection failed; check state before retry.","فشل الاتصال؛ تحقق من الحالة قبل إعادة المحاولة."));}
    finally{setBusy(false);}
  }
  return <section className="table-card detail-section">
    {notice&&<p role="status" className="form-warning">{notice}</p>}
    <div className="table-wrap"><table><thead><tr>
      <th>{tr("Patient / doctor","المريض / الطبيب")}</th><th>{tr("Branch","الفرع")}</th>
      <th>{tr("Requested tests","الفحوصات المطلوبة")}</th><th>{tr("Status / time","الحالة / الوقت")}</th>
      <th>{tr("Action","الإجراء")}</th>
    </tr></thead><tbody>{rows.map(r=><tr key={r.id}>
      <td>{r.patient}<small className="table-subtext">{r.doctor}</small></td>
      <td>{r.branch}</td>
      <td>{r.tests.join(", ")}
        <small className="table-subtext">{r.priority} · {r.diagnosis||"—"}</small>
        {r.clinicalNotes&&<small className="table-subtext">{r.clinicalNotes}</small>}</td>
      <td>{r.status}<small className="table-subtext"><SystemDateText value={r.submittedAt} timeZone={r.branchTimeZone} /></small>
        {r.resolutionReason&&<small className="table-subtext">{r.resolutionReason}</small>}</td>
      <td>{r.status==="SUBMITTED"&&<>
        <Link className="secondary-link" href={`/orders?doctorRequisitionId=${r.id}`}>
          {tr("Review & register","مراجعة وتسجيل")}</Link>
        <button type="button" className="secondary-button" disabled={busy}
          onClick={()=>{setReason("");setNotice("");setDecliningId(r.id);}}>{tr("Decline","رفض")}</button>
      </>}
      {r.fulfilledOrderId&&<Link className="secondary-link" href={`/orders/${r.fulfilledOrderId}`}>
        {tr("Open registered order","فتح الطلب المسجّل")}</Link>}</td>
    </tr>)}</tbody></table></div>
    {rows.length===0&&<p className="muted">{tr("No requisitions in this page.","لا توجد إحالات في هذه الصفحة.")}</p>}
    <CrudModal open={decliningId!==null} onClose={()=>{if(!busy)setDecliningId(null);}}
      size="compact"
      title={tr("Decline Clinical Requisition", "رفض إحالة سريرية")}
      description={tr("Declining this requisition does not generate an LIS order or invoice; the decision is audited.",
        "لا ينشئ رفض الإحالة طلباً مخبرياً أو فاتورة؛ يُوثّق القرار في سجل التدقيق.")}>
      {decliningId&&<form className="form-stack" onSubmit={e=>void decline(e)}>
        <label>{tr("Reason (10–1000 characters)", "السبب (10–1000 محرف)")}
          <textarea value={reason} required minLength={10} maxLength={1000} rows={4}
            onChange={e=>setReason(e.target.value)}/>
        </label>
        {notice&&<p role="alert" className="form-warning">{notice}</p>}
        <button type="submit" className="primary-button" disabled={busy||reason.trim().length<10}>
          {tr("Confirm decline", "تأكيد الرفض")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
