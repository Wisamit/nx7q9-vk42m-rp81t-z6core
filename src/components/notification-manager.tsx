"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const EVENT_TYPES = [
  "RESULT_READY",
  "CRITICAL_RESULT",
  "SPECIMEN_REJECTED",
  "PAYMENT_ISSUE",
  "QC_FAILURE",
  "LOW_STOCK",
  "MAINTENANCE_DUE",
  "SHIPMENT_ARRIVAL",
];

type Branch = { id: string; code: string; nameEn: string };
type Preference = { eventType: string; channel: string; enabled: boolean };

function field(form:FormData,key:string){const v=form.get(key);return typeof v==="string"?v:"";}

export function NotificationManager({
  branches,
  canManage,
  preferences,
}:{
  branches:Branch[];
  canManage:boolean;
  preferences:Preference[];
}){
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function createTemplate(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const f=new FormData(event.currentTarget);
    setBusy("template"); setMessage("");
    const response=await fetch("/api/notifications/templates",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        branchId:field(f,"branchId")||null,
        code:field(f,"code"),eventType:field(f,"eventType"),channel:field(f,"channel"),locale:field(f,"locale"),
        subjectTemplate:field(f,"subjectTemplate"),bodyTemplate:field(f,"bodyTemplate"),effectiveFrom:field(f,"effectiveFrom")||null,
      }),
    });
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setMessage(data.error||"Template creation failed.");return;}
    setMessage("New notification template version created.");
    event.currentTarget.reset(); router.refresh();
  }

  async function setPreference(eventType:string,enabled:boolean){
    setBusy("pref-"+eventType); setMessage("");
    const response=await fetch("/api/notifications/preferences",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({eventType,channel:"IN_APP",enabled}),
    });
    const data=await response.json().catch(()=>({}));
    setBusy("");
    if(!response.ok){setMessage(data.error||"Preference update failed.");return;}
    router.refresh();
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>My In-App Preferences</h2>
      <p className="muted">Disable non-mandatory in-app notification types for your account. Clinical workflow controls remain independent of notification preferences.</p>
      <div className="notification-preferences">
        {EVENT_TYPES.map(eventType=>{
          const current=preferences.find(item=>item.eventType===eventType&&item.channel==="IN_APP");
          const enabled=current?.enabled!==false;
          return <label className="notification-preference-row" key={eventType}>
            <span>{eventType.replaceAll("_"," ")}</span>
            <input type="checkbox" checked={enabled} disabled={busy==="pref-"+eventType}
              onChange={e=>void setPreference(eventType,e.target.checked)} />
          </label>;
        })}
      </div>
    </article>

    {canManage&&<article className="detail-card">
      <h2>Create Template Version</h2>
      <p className="muted">Templates are versioned/effective-dated. Existing rendered deliveries keep their original subject/body.</p>
      <form className="catalog-form" onSubmit={createTemplate}>
        <label>Branch<select name="branchId"><option value="">Organization default</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.nameEn}</option>)}</select></label>
        <label>Code<input name="code" required placeholder="RESULT_READY_PATIENT" /></label>
        <label>Event type<select name="eventType">{EVENT_TYPES.map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Channel<select name="channel"><option>IN_APP</option><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option></select></label>
        <label>Locale<select name="locale"><option value="en">English</option><option value="ar">Arabic</option></select></label>
        <label>Effective from<input name="effectiveFrom" type="datetime-local" /></label>
        <label className="form-span">Subject<input name="subjectTemplate" placeholder="Result ready: {{accessionNumber}}" /></label>
        <label className="form-span">Body<textarea name="bodyTemplate" required rows={5} placeholder="Use {{variable}} placeholders from the notification payload." /></label>
        <button className="primary-button form-span" disabled={busy==="template"}>{busy==="template"?"Saving…":"Create template version"}</button>
      </form>
    </article>}
    {message&&<p className="form-success form-span">{message}</p>}
  </div>;
}

export function NotificationRowActions({id,readAt,canRetry,status}:{id:string;readAt:string|null;canRetry:boolean;status:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  async function post(url:string){
    setBusy(true); await fetch(url,{method:"POST"}); setBusy(false); router.refresh();
  }
  return <div className="review-actions">
    {!readAt&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void post("/api/notifications/"+id+"/read")}>Mark read</button>}
    {canRetry&&["QUEUED","FAILED"].includes(status)&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void post("/api/notifications/deliveries/"+id+"/retry")}>Retry</button>}
  </div>;
}
