"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
type Row={id:string;status:string;submittedAt:string;patient:string;
  branch:string;doctor:string;priority:string;tests:string[];
  diagnosis:string|null;clinicalNotes:string|null;fulfilledOrderId:string|null;
  resolutionReason:string|null};
export function DoctorRequisitionReview({locale,rows}:{locale:"ar"|"en";rows:Row[]}) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const router=useRouter();
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  async function decline(id:string) {
    const reason=prompt(tr("Reason for declining this clinical requisition (10–1000 characters):",
      "سبب رفض الإحالة السريرية (10–1000 محرف):"));
    if(reason===null)return;
    if(reason.trim().length<10||reason.trim().length>1000) {
      setNotice(tr("A detailed reason is required.","السبب التفصيلي إلزامي."));return;
    }
    if(!confirm(tr("Decline without generating an order or invoice?",
      "رفض الإحالة دون إنشاء طلب مخبري أو فاتورة؟")))return;
    setBusy(true);setNotice("");
    try{
      const r=await fetch("/api/doctor-requisitions/review",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,decision:"DECLINE",reason:reason.trim()}),
      });
      const data=await r.json().catch(()=>({})) as {error?:string};
      setNotice(r.ok?tr("Decision logged.","تم توثيق القرار."):
        tr("Unable to decline: ","تعذر الرفض: ")+(data.error||"unknown"));
      if(r.ok)router.refresh();
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
      <td>{r.status}<small className="table-subtext">{r.submittedAt.slice(0,16)}</small>
        {r.resolutionReason&&<small className="table-subtext">{r.resolutionReason}</small>}</td>
      <td>{r.status==="SUBMITTED"&&<>
        <Link className="secondary-link" href={`/orders?doctorRequisitionId=${r.id}`}>
          {tr("Review & register","مراجعة وتسجيل")}</Link>
        <button type="button" className="secondary-button" disabled={busy}
          onClick={()=>void decline(r.id)}>{tr("Decline","رفض")}</button>
      </>}
      {r.fulfilledOrderId&&<Link className="secondary-link" href={`/orders/${r.fulfilledOrderId}`}>
        {tr("Open registered order","فتح الطلب المسجّل")}</Link>}</td>
    </tr>)}</tbody></table></div>
    {rows.length===0&&<p className="muted">{tr("No requisitions in this page.","لا توجد إحالات في هذه الصفحة.")}</p>}
  </section>;
}
