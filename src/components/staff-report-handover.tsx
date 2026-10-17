"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function StaffReportHandover({
  reportVersionId,locale,
}:{reportVersionId:string;locale:"ar"|"en"}){
  const router=useRouter();
  const [patientNumber,setPatientNumber]=useState("");
  const [method,setMethod]=useState("PHOTO_ID_AND_PATIENT_NUMBER");
  const [attested,setAttested]=useState(false);
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false);
  const [recorded,setRecorded]=useState(false);
  const [message,setMessage]=useState("");
  const requestId=useRef<{id:string;payload:string}|null>(null);
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||recorded||!attested)return;
    const payload=JSON.stringify({
      patientNumber:patientNumber.trim(),
      verificationMethod:method,attestedInPerson:true,
    });
    if(requestId.current?.payload!==payload)
      requestId.current={id:crypto.randomUUID(),payload};
    const handoverRequestId=requestId.current.id;
    setBusy(true);
    setMessage("");
    try{
      const response=await fetch(`/api/reports/${reportVersionId}/handover`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          handoverRequestId,patientNumber:patientNumber.trim(),
          verificationMethod:method,attestedInPerson:true,
        }),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        const code=String(data.error||"");
        const explanation=code==="patient_identifiers_do_not_match_report"?
          tr("Patient number does not match the immutable report. No handover was recorded.",
            "رقم المريض لا يطابق التقرير المحفوظ. لم يُسجَّل التسليم."):
          code==="report_not_current_and_final"||code==="handover_conflict_or_version_changed"?
          tr("The report version changed or is not eligible. Review the latest version.",
            "تغيّر إصدار التقرير أو لم يعد مؤهلاً. راجع آخر إصدار."):
          code==="handover_requires_active_ordering_branch"?
          tr("Switch to the ordering branch with delivery permission.","انتقل إلى فرع الطلب مع صلاحية التسليم."):
          tr("Could not record staff attestation. Review the report and try again.",
            "تعذر تسجيل إقرار الموظف. راجع التقرير وأعد المحاولة.");
        setMessage(explanation);
        return;
      }
      setRecorded(true);
      setOpen(false);
      setAttested(false);
      setMessage(tr("Staff attestation recorded in the immutable delivery log. No independent patient acknowledgement has been obtained.",
        "تم تسجيل إقرار الموظف في سجل التسليم. لم يتم الحصول على إقرار استلام مستقل من المريض."));
      router.refresh();
    }catch{
      setMessage(tr("Connection failed. Repeat with the same details; the request ID is retained to prevent duplicate audit records.",
        "فشل الاتصال. كرر بنفس التفاصيل؛ سيُعاد استخدام رقم الطلب لمنع تسجيل حدثين مكررين."));
    }finally{setBusy(false)}
  }
  return <section className="detail-card no-print">
    <h2>{tr("In-person patient handover (staff attestation)","تسليم التقرير للمريض حضورياً (إقرار الموظف)")}</h2>
    <p className="muted">{tr(
      "Only use after physically handing the current final/amended report to the patient. This is a staff statement, not a patient signature or independently verified proof of receipt. Do not enter ID document numbers.",
      "استخدمه فقط بعد تسليم الإصدار النهائي/المعدل الحالي للمريض شخصياً. هذا إقرار من الموظف، وليس توقيع المريض أو دليلاً مستقلاً على الاستلام. لا تُدخل أرقام وثائق الهوية.",
    )}</p>
    {!recorded && <button type="button" className="primary-button" disabled={busy}
      onClick={() => { setMessage(""); setAttested(false); setOpen(true); }}>
      {tr("Record in-person handover", "تسجيل التسليم الحضوري")}
    </button>}
    <CrudModal open={open} onClose={() => { if(!busy) {setOpen(false);setAttested(false);} }} size="compact"
      title={tr("Verify patient identity before attestation", "تحقق من هوية المريض قبل تسجيل الإقرار")}
      description={tr("Record this only after the current final report was physically handed to the patient. Staff attestation is not a patient signature.", "سجّل هذا فقط بعد تسليم التقرير النهائي الحالي للمريض حضورياً. إقرار الموظف ليس توقيعاً من المريض.")}>
    {open && <form className="catalog-form" onSubmit={e=>void submit(e)}>
      <label>{tr("Confirm patient number printed on this report","أكد رقم المريض المطبوع على هذا التقرير")}
        <input required maxLength={50} value={patientNumber}
          autoComplete="off" onChange={e=>setPatientNumber(e.target.value)}
          disabled={busy||recorded}/>
      </label>
      <label>{tr("Staff identity check performed","طريقة التحقق من هوية المريض")}
        <select value={method} onChange={e=>setMethod(e.target.value)}
          disabled={busy||recorded}>
          <option value="PHOTO_ID_AND_PATIENT_NUMBER">
            {tr("Photo ID and patient number matched","مطابقة هوية شخصية مصورة ورقم المريض")}
          </option>
          <option value="TWO_PATIENT_IDENTIFIERS">
            {tr("Two patient identifiers matched","مطابقة مُعرّفين اثنين للمريض")}
          </option>
        </select>
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={attested} disabled={busy||recorded}
          onChange={e=>setAttested(e.target.checked)}/>
        {tr("I personally handed this current report to the patient and performed the selected identity check.",
          "أقرّ بأنني سلّمت هذا الإصدار الحالي للمريض شخصياً وتحققت من هويته بالطريقة المحددة.")}
      </label>
      <div className="crud-modal-actions form-span"><button className="primary-button" disabled={busy||recorded||!attested||!patientNumber.trim()} type="submit">
        {busy?tr("Recording…","جارٍ التسجيل…"):recorded?
          tr("Attestation recorded","تم تسجيل الإقرار"):
          tr("Record staff handover attestation","تسجيل إقرار التسليم")}
      </button></div>
      {message&&<p className="form-error form-span" role="alert">{message}</p>}
    </form>}
    </CrudModal>
    {!open && message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}
