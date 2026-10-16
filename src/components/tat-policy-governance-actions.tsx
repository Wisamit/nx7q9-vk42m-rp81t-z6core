"use client";

import {type FormEvent, useState} from "react";
import {useRouter} from "next/navigation";
import {CrudModal} from "@/components/crud-modal";

export function TatPolicyGovernanceActions({
  id,approvalStatus,locale,
}: {
  id:string;
  approvalStatus:"DRAFT"|"APPROVED"|"RETIRED";
  locale:"ar"|"en";
}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [review,setReview]=useState<"APPROVE"|"RETIRE"|null>(null);
  const [reason,setReason]=useState("");
  const tr=<T,>(en:T,ar:T)=>locale==="ar"?ar:en;

  function openReview(action:"APPROVE"|"RETIRE") {
    if(busy || approvalStatus==="RETIRED" ||
      (action==="APPROVE"&&approvalStatus!=="DRAFT") ||
      (action==="RETIRE"&&approvalStatus!=="APPROVED"))return;
    setMessage("");setReason("");setReview(action);
  }

  async function submitReview(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy||!review || (review==="APPROVE"&&approvalStatus!=="DRAFT") ||
      (review==="RETIRE"&&approvalStatus!=="APPROVED"))return;
    const decision=review;
    const documentedReason=decision==="RETIRE"?reason.trim():"";
    if(decision==="RETIRE"&&documentedReason.length<10){
      setMessage(tr("A documented retirement reason (at least 10 characters) is required.",
        "يجب توثيق سبب الإيقاف بعشرة محارف على الأقل."));
      return;
    }
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/catalog/tat-policies",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,action:decision,reason:documentedReason}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(response.ok){
        setReview(null);setReason("");
        router.refresh();
      }else if(body.error==="approved_tat_policy_overlap"){
        setMessage(tr("Approval blocked: another approved policy with the same branch / priority scope overlaps this effective period.",
          "تعذر الاعتماد: توجد سياسة معتمدة أخرى بنفس نطاق الفرع / الأولوية وتتداخل مع فترة السريان."));
      }else{
        setMessage(body.error||tr("Could not update TAT / SLA policy.","تعذر تحديث سياسة TAT / SLA."));
      }
    }catch{
      setMessage(tr("Connection interrupted. Review current policy revision before retrying.",
        "انقطع الاتصال. راجع الإصدار الحالي للسياسة قبل إعادة المحاولة."));
    }finally{setBusy(false);}
  }

  if(approvalStatus==="RETIRED")return null;

  return <div>
    {approvalStatus==="DRAFT"&&<button type="button" className="primary-button" disabled={busy}
      onClick={()=>openReview("APPROVE")}>{tr("Approve","اعتماد")}</button>}
    {approvalStatus==="APPROVED"&&<button type="button" className="secondary-button" disabled={busy}
      onClick={()=>openReview("RETIRE")}>{tr("Retire","إيقاف")}</button>}
    <CrudModal open={review!==null} onClose={()=>{if(!busy)setReview(null);}}
      size="compact"
      title={review==="APPROVE"
        ?tr("Approve TAT / SLA Policy","اعتماد سياسة TAT / SLA")
        :tr("Retire TAT / SLA Policy","إيقاف سياسة TAT / SLA")}
      description={tr(
        "Review the effective date, branch, urgency and scope. Approval may supersede an earlier overlapping policy; past clinical timings and reports are not overwritten.",
        "راجع تاريخ السريان والفرع والأولوية والنطاق. قد يحل الاعتماد محل سياسة سابقة؛ لا يتغير تاريخ أوقات المختبر أو التقارير.",
      )}>
      {review&&<form className="catalog-form" onSubmit={submitReview}>
        {review==="APPROVE"?
          <p className="form-span">{tr("Confirm this draft policy is clinically and operationally reviewed before activation.",
            "أكّد مراجعة هذه المسودة سريرياً وتشغيلياً قبل التفعيل.")}</p>:
          <label className="form-span">{tr("Document retirement reason","دوّن سبب الإيقاف")}
            <textarea value={reason} onChange={e=>setReason(e.target.value)}
              required minLength={10} maxLength={1000} rows={3}/>
          </label>}
        {message&&<p className="form-error form-span" role="alert">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy?tr("Saving…","جارٍ الحفظ…"):tr("Confirm governed decision","تأكيد القرار المحكوم")}
        </button>
      </form>}
    </CrudModal>
    {message&&<p className="form-error" role="alert">{message}</p>}
  </div>;
}
