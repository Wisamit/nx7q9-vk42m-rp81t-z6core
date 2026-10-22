"use client";
import {FormEvent,useState} from "react";
import {CrudModal} from "@/components/crud-modal";

export type StepUpPurpose="MEDICAL_APPROVAL"|"RESULT_RELEASE"|"DISCOUNT_APPROVAL"|"REFUND_POST"|"PATIENT_MERGE"|"RESULT_AMEND"|"CREDIT_NOTE_ISSUE"|"CLINICAL_RULE_APPROVE"|"CLINICAL_RULE_RETIRE";
export function StaffStepUpDialog({open,action,resourceKey,branchId,locale,onCancel,onGranted}:{
  open:boolean;action:StepUpPurpose;resourceKey:string;branchId:string;
  locale:"ar"|"en";onCancel:()=>void;onGranted:(token:string)=>void;
}) {
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [password,setPassword]=useState(""),[totp,setTotp]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!password)return;
    setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/security/step-up",{
        method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
        body:JSON.stringify({action,resourceKey,branchId,password,totp}),
      });
      const body=await r.json().catch(()=>({})) as {error?:string;token?:string};
      setPassword("");setTotp("");
      if(!r.ok||!body.token){
        setMessage(tr("Reauthentication failed: ","فشل إعادة التحقق: ")+(body.error||"unknown"));
        return;
      }
      onGranted(body.token);
    }catch{
      setPassword("");setTotp("");
      setMessage(tr("Connection interrupted. No approval was performed.","انقطع الاتصال؛ لم ينفذ أي اعتماد."));
    }finally{setBusy(false);}
  }
  return <CrudModal open={open} onClose={()=>{
    if(!busy){setPassword("");setTotp("");setMessage("");onCancel();}
  }} title={tr("Verify identity for high-risk action","تأكيد الهوية قبل الإجراء الحساس")}
    description={tr("Your approval is tied to this item and expires within two minutes. Enter your current password and, if enabled, the six-digit authenticator code.",
      "الإثبات مرتبط بهذا السجل وتنتهي صلاحيته خلال دقيقتين. أدخل كلمة المرور الحالية ورمز تطبيق المصادقة إذا كان مفعّلاً.")} size="compact">
    <form className="catalog-form" onSubmit={e=>void submit(e)}>
      <label>{tr("Current password","كلمة المرور الحالية")}
        <input type="password" autoComplete="current-password" value={password}
          onChange={e=>setPassword(e.target.value)} maxLength={256} required/></label>
      <label>{tr("Authenticator code (required when MFA is enabled)","رمز المصادقة (إلزامي عند تفعيل MFA)")}
        <input type="text" inputMode="numeric" autoComplete="one-time-code"
          value={totp} onChange={e=>setTotp(e.target.value)} maxLength={20}
          placeholder={tr("Six digits, if enabled","ستة أرقام عند التفعيل")}/></label>
      <button type="submit" className="primary-button" disabled={busy||!password||!resourceKey||!branchId}>
        {busy?tr("Verifying…","جارٍ التحقق…"):tr("Verify and continue","تحقق وتابع")}</button>
      {message&&<p role="alert" className="form-error">{message}</p>}
    </form>
  </CrudModal>;
}
