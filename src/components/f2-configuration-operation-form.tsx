"use client";

import {useRef,useState,type FormEvent} from "react";

type Mode="APPLY"|"REVERSE";
type Outcome={
  state:string;changedRows:number;effectiveAt:string;
  masterWritesScheduled:boolean;masterVersionsReversed:boolean;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states:Record<Mode,readonly string[]>={
  APPLY:[
    "TEN_CLASS_CONFIGURATION_SCHEDULED",
    "EFFECTIVE_VERSIONS_APPLIED",
    "EFFECTIVE_VERSIONS_ALREADY_APPLIED",
  ],
  REVERSE:[
    "TEN_CLASS_CONFIGURATION_REVERSED",
    "FUTURE_EFFECTIVE_VERSIONS_REVERSED",
    "FUTURE_VERSIONS_ALREADY_REVERSED",
  ],
};
const expectedWord=(mode:Mode)=>mode==="APPLY"?"APPLY":"REVERSE";
function verifiedResponse(value:unknown,mode:Mode):value is Outcome{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const body=value as Record<string,unknown>;
  return states[mode].includes(String(body.state))&&
    typeof body.changedRows==="number"&&
    Number.isSafeInteger(body.changedRows)&&body.changedRows>=0&&
    typeof body.effectiveAt==="string"&&
    !Number.isNaN(Date.parse(body.effectiveAt))&&
    body.masterWritesScheduled===(mode==="APPLY")&&
    body.masterVersionsReversed===(mode==="REVERSE");
}

/**
 * Operator-only interaction: two explicit permissions are independently
 * checked on the server, which reacquires a tenant FOR UPDATE lock and
 * reloads all signed source, clinical/financial signatory and live evidence.
 * This widget never sends any source values, snapshots or authorization flags.
 */
export function F2ConfigurationOperationForm({locale,allowedModes}:{
  locale:"ar"|"en";allowedModes:readonly Mode[];
}){
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [batchId,setBatchId]=useState("");
  const [mode,setMode]=useState<Mode>(allowedModes[0]??"APPLY");
  const [confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState<Outcome|null>(null);
  const pending=useRef(false);
  const word=expectedWord(mode);
  const canSubmit=UUID.test(batchId)&&confirmation===word&&
    allowedModes.includes(mode)&&!busy;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!canSubmit||pending.current)return;
    pending.current=true;setBusy(true);setError("");setResult(null);
    try{
      const action=mode==="APPLY"?"configuration-apply":"configuration-reverse";
      const response=await fetch(
        "/api/catalog/imports/"+encodeURIComponent(batchId)+"/"+action,{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Length":"0"},
        },
      );
      const body:unknown=await response.json();
      if(!response.ok||!verifiedResponse(body,mode)){
        const message=body&&typeof body==="object"&&"error" in body?
          String((body as {error:unknown}).error):
          "f2_configuration_operation_rejected";
        throw Error(message);
      }
      setResult(body);
      setConfirmation("");
    }catch(err){
      setError(err instanceof Error?err.message:"f2_configuration_operation_failed");
    }finally{setBusy(false);pending.current=false;}
  }
  if(!allowedModes.length)return null;
  return <section className="table-card detail-section no-print"
    aria-labelledby="f2-configuration-operation-title">
    <div className="table-toolbar">
      <h2 id="f2-configuration-operation-title">
        {tr("Governed configuration operations","عمليات تطبيق الإعدادات المحكومة")}
      </h2>
    </div>
    <p className="muted">{tr(
      "A separate operator may schedule a fully signed configuration change or cancel an unused future-effective version. These actions require independent clinical and finance decisions, verified source lineage and current branch-scoped permissions. Released or already-effective history is not rewritten.",
      "يمكن لمشغّل مستقل جدولة تعديل معتمد أو إلغاء إصدار مستقبلي لم يُستخدم. يتطلب التنفيذ توقيعين مستقلين طبيّاً وماليّاً، وإثبات مصدر البيانات وصلاحيات الفرع الحالية. لا تُعدّل السجلات الصادرة أو التاريخية.",
    )}</p>
    <form onSubmit={submit} className="form-grid">
      <label>{tr("Configuration import batch ID","معرّف دفعة إعدادات المختبر")}
        <input dir="ltr" value={batchId} maxLength={36} spellCheck={false}
          autoComplete="off" required
          onChange={event=>{setBatchId(event.target.value.trim());
            setConfirmation("");setError("");setResult(null);}}
          placeholder="00000000-0000-4000-8000-000000000000"/>
      </label>
      <label>{tr("Operation","العملية")}
        <select value={mode} disabled={busy}
          onChange={event=>{setMode(event.target.value as Mode);
            setConfirmation("");setError("");setResult(null);}}>
          {allowedModes.includes("APPLY")&&<option value="APPLY">
            {tr("Schedule approved change","جدولة التغيير المعتمد")}
          </option>}
          {allowedModes.includes("REVERSE")&&<option value="REVERSE">
            {tr("Cancel future-effective change","إلغاء تغيير مستقبلي")}
          </option>}
        </select>
      </label>
      <p className="muted">{mode==="APPLY"?tr(
        "This can schedule new prices, reference intervals and effective catalog versions. The server checks current approvals before any write.",
        "قد تؤدي العملية إلى جدولة أسعار ومجالات مرجعية وإصدارات جديدة للدليل. يتحقق الخادم من الاعتمادات الحالية قبل أي تعديل.",
      ):tr(
        "Only a not-yet-effective, unused version can be cancelled. Historical versions are retained.",
        "لا يمكن إلغاء إلا إصدار لم يبدأ سريانه ولم يُستخدم، مع الاحتفاظ بالإصدارات السابقة.",
      )}</p>
      <label>{tr("Type the confirmation word","اكتب كلمة التأكيد")}
        <input dir="ltr" required autoComplete="off" spellCheck={false}
          value={confirmation} disabled={busy} maxLength={7}
          onChange={event=>setConfirmation(event.target.value)}
          aria-description={tr("Type "+word+" exactly","اكتب "+word+" تماماً")}
          placeholder={word}/>
      </label>
      <button type="submit" className="primary-button" disabled={!canSubmit}>
        {busy?tr("Verifying and executing…","التحقق والتنفيذ…"):
          mode==="APPLY"?tr("Apply governed change","تطبيق التغيير المحكوم"):
          tr("Reverse future change","إلغاء التغيير المستقبلي")}
      </button>
    </form>
    {error&&<p role="alert" className="error-text">{tr(
      "Operation refused: ","تم رفض العملية: ")}{error}</p>}
    {result&&<p role="status">{tr(
      "Server-confirmed operation: ","العملية المؤكدة من الخادم: ")}
      {result.state} — {tr("Changed rows","الصفوف المتغيرة")}: {result.changedRows}
      {" · "}{tr("Effective at (UTC)","تاريخ السريان (UTC)")}: {result.effectiveAt}
    </p>}
  </section>;
}
