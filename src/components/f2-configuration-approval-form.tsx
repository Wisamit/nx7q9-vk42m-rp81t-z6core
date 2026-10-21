"use client";

import {useState,type FormEvent} from "react";

type Domain="CLINICAL"|"FINANCIAL";
type Decision="APPROVE"|"REJECT";
type Status={
  status:"NOT_SIGNED"|"PARTIALLY_SIGNED"|"TWO_DOMAINS_SIGNED";
  revision:0|1|2;effectiveAt:string|null;
  clinicalDecision:Decision|null;financialDecision:Decision|null;
  technicallyApproved:boolean;operationalReleaseApproved:false;
  readOnly:true;liveWrites:false;
};
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const validStatus=(v:unknown):v is Status=>{
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const x=v as Record<string,unknown>;
  return ["NOT_SIGNED","PARTIALLY_SIGNED","TWO_DOMAINS_SIGNED"].includes(String(x.status)) &&
    (x.revision===0||x.revision===1||x.revision===2) &&
    (x.effectiveAt===null||typeof x.effectiveAt==="string"&&ISO.test(x.effectiveAt)) &&
    [null,"APPROVE","REJECT"].includes(x.clinicalDecision as string|null) &&
    [null,"APPROVE","REJECT"].includes(x.financialDecision as string|null) &&
    typeof x.technicallyApproved==="boolean"&&
    x.operationalReleaseApproved===false&&x.readOnly===true&&x.liveWrites===false;
};

export function F2ConfigurationApprovalForm({
  locale,allowedDomains,
}:{
  locale:"ar"|"en";allowedDomains:readonly Domain[];
}){
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [batchId,setBatchId]=useState("");
  const [status,setStatus]=useState<Status|null>(null);
  const [domain,setDomain]=useState<Domain>(allowedDomains[0]||"CLINICAL");
  const [decision,setDecision]=useState<Decision|null>(null);
  const [effectiveAt,setEffectiveAt]=useState("");
  const [totp,setTotp]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  async function inspect(id=batchId):Promise<boolean>{
    if(!ID.test(id)){setError("invalid_batch_id");return false;}
    const response=await fetch("/api/catalog/imports/"+encodeURIComponent(id)+
      "/configuration-approval/status",{
      method:"GET",cache:"no-store",credentials:"same-origin",
    });
    const body:unknown=await response.json();
    if(!response.ok||!validStatus(body)){
      setStatus(null);
      const code=body&&typeof body==="object"&&"error" in body?
        String((body as {error:unknown}).error):"configuration_status_unavailable";
      throw Error(code);
    }
    setStatus(body);
    if(body.effectiveAt)setEffectiveAt(body.effectiveAt);
    return true;
  }
  async function onInspect(){
    if(busy)return;
    setBusy(true);setError("");setMessage("");setStatus(null);
    try{await inspect();}
    catch(caught){setError(caught instanceof Error?caught.message:"configuration_status_unavailable");}
    finally{setBusy(false);}
  }
  async function onSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy||!status||status.revision>=2||!decision||
       !allowedDomains.includes(domain)||!/^\d{6}$/.test(totp)||
       !ISO.test(effectiveAt)||!Number.isFinite(Date.parse(effectiveAt))){
      setError("configuration_sign_invalid_input");return;
    }
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/catalog/imports/"+encodeURIComponent(batchId)+
        "/configuration-approval",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({domain,decision,effectiveAt,
          expectedRevision:status.revision,mfaCode:totp}),
      });
      const body:unknown=await response.json();
      if(!response.ok||!body||typeof body!=="object"||
         !("status" in body)||
         (body as {status:unknown}).status!=="CONFIGURATION_APPROVAL_EVIDENCE_RECORDED"||
         (body as {liveWrites?:unknown}).liveWrites!==false){
        const code=body&&typeof body==="object"&&"error" in body?
          String((body as {error:unknown}).error):"configuration_sign_failed";
        throw Error(code);
      }
      setTotp("");setDecision(null);
      setMessage(tr("Decision recorded in the signed audit ledger. No catalog master was changed.",
        "تم تسجيل القرار في سجل التدقيق الموقّع دون تعديل أي بيانات رئيسية."));
      await inspect();
    }catch(caught){
      setError(caught instanceof Error?caught.message:"configuration_sign_failed");
    }finally{setBusy(false);}
  }
  const otherDomainAlreadySigned=status?.revision===1&&
    (domain==="CLINICAL"?status.clinicalDecision!==null:status.financialDecision!==null);
  return <section className="table-card detail-section">
    <div className="table-toolbar">
      <h2>{tr("Configuration sign-off","توقيع مراجعة الإعدادات")}</h2>
    </div>
    <p className="muted">{tr(
      "Two separate signers must review the same batch, source snapshot, policy and effective date. Signed decisions alone do not publish configuration.",
      "يجب أن يراجع شخصان مستقلان نفس الدفعة ونسخة البيانات والسياسة وتاريخ السريان. التوقيعات وحدها لا تنشر الإعدادات."
    )}</p>
    <div className="form-grid">
      <label>{tr("Import batch ID","معرّف دفعة الاستيراد")}
        <input value={batchId} onChange={e=>{setBatchId(e.target.value.trim());setStatus(null);setMessage("");}}
          placeholder={tr("Enter batch UUID","أدخل معرّف الدفعة")} spellCheck={false}
          autoComplete="off" maxLength={36} dir="ltr"/>
      </label>
      <button type="button" className="secondary-button" disabled={busy||!ID.test(batchId)}
        onClick={onInspect}>{tr("Check signed status","التحقق من حالة التوقيع")}</button>
    </div>
    {status&&<p className="muted" role="status">
      {tr("Signed decisions","القرارات الموقّعة")}: {status.revision}/2 —{" "}
      {tr("Clinical","طبي")}: {status.clinicalDecision||tr("Pending","بانتظار")} —{" "}
      {tr("Financial","مالي")}: {status.financialDecision||tr("Pending","بانتظار")}
    </p>}
    {status&&status.revision<2&&<form onSubmit={onSubmit} className="form-grid">
      <label>{tr("Signing domain","مجال التوقيع")}
        <select value={domain} onChange={e=>setDomain(e.target.value as Domain)}>
          {allowedDomains.map(v=><option key={v} value={v}>
            {v==="CLINICAL"?tr("Clinical","طبي"):tr("Financial","مالي")}
          </option>)}
        </select>
      </label>
      <label>{tr("Decision","القرار")}
        <select value={decision||""} onChange={e=>
          setDecision(e.target.value===""?null:e.target.value as Decision)}>
          <option value="">{tr("Choose a decision","اختر القرار")}</option>
          <option value="APPROVE">{tr("Approve reviewed configuration","الموافقة على الإعدادات المراجعة")}</option>
          <option value="REJECT">{tr("Reject","رفض")}</option>
        </select>
      </label>
      <label>{tr("Effective date (UTC ISO 8601)","تاريخ السريان (UTC ISO 8601)")}
        <input type="text" dir="ltr" value={effectiveAt}
          onChange={e=>setEffectiveAt(e.target.value)} disabled={status.revision===1}
          placeholder="2026-12-01T00:00:00.000Z" autoComplete="off"/>
      </label>
      <label>{tr("Current authenticator code","رمز المصادقة الحالي")}
        <input type="text" inputMode="numeric" pattern="[0-9]{6}" dir="ltr"
          maxLength={6} value={totp} autoComplete="one-time-code"
          onChange={e=>setTotp(e.target.value.replace(/\D/g,"").slice(0,6))}/>
      </label>
      <button type="submit" disabled={busy||otherDomainAlreadySigned||!decision||
        totp.length!==6||!ISO.test(effectiveAt)}>
        {tr("Record signed decision","تسجيل القرار الموقّع")}
      </button>
      {otherDomainAlreadySigned&&<p className="muted">
        {tr("This domain already has a decision. The other domain must use a different account.",
          "تم تسجيل قرار هذا المجال. يجب أن يستخدم المجال الآخر حساباً مختلفاً.")}
      </p>}
    </form>}
    {status?.revision===2&&<p className="muted">
      {tr("Both domain decisions have been recorded. This is not authorization to publish or apply configuration.",
        "تم تسجيل القرارين. هذا لا يعني السماح بنشر الإعدادات أو تطبيقها.")}
    </p>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
