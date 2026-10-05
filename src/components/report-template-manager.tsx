"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id:string; code:string; name:string };
type Template = { id:string; code:string; name:string; branchId:string|null; latestVersion:number|null; latestStatus:string|null };

export function ReportTemplateManager({ branches, templates }: { branches:Branch[]; templates:Template[] }) {
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function createTemplate(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); setBusy("template"); setMessage("");
    const f=new FormData(event.currentTarget);
    const response=await fetch("/api/report-templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:f.get("code"),nameEn:f.get("nameEn"),nameAr:f.get("nameAr"),branchId:f.get("branchId")||null,isDefault:true,
    })});
    setBusy(""); setMessage(response.ok?"Template created.":"Template creation failed.");
    if(response.ok){event.currentTarget.reset();router.refresh();}
  }

  async function createVersion(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); setBusy("version"); setMessage("");
    const f=new FormData(event.currentTarget);
    const templateId=String(f.get("templateId")||"");
    const columns=["TEST","RESULT","FLAG","UNIT","REFERENCE"].filter(key=>f.get("col_"+key)==="on");
    const response=await fetch(`/api/report-templates/${templateId}/versions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      changeSummary:f.get("changeSummary"),
      configuration:{
        languageMode:f.get("languageMode"),
        logoUrl:f.get("logoUrl"),
        headerEn:f.get("headerEn"),headerAr:f.get("headerAr"),
        footerEn:f.get("footerEn"),footerAr:f.get("footerAr"),
        watermark:f.get("watermark"),
        showSignature:f.get("showSignature")==="on",
        showQr:f.get("showQr")==="on",
        showPageNumbers:f.get("showPageNumbers")==="on",
        columns,
      },
    })});
    setBusy(""); setMessage(response.ok?"Draft version created.":"Version creation failed.");
    if(response.ok){event.currentTarget.reset();router.refresh();}
  }

  async function activate(templateId:string,versionId:string){
    setBusy("activate:"+versionId);setMessage("");
    const response=await fetch(`/api/report-templates/${templateId}/versions/${versionId}/activate`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    setBusy("");setMessage(response.ok?"Template version is now effective.":"Activation failed.");
    if(response.ok)router.refresh();
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>Create Template</h2>
      <form className="catalog-form" onSubmit={createTemplate}>
        <label>Code<input name="code" required placeholder="DEFAULT_REPORT"/></label>
        <label>Branch<select name="branchId"><option value="">Organization-wide</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>
        <label>Name (English)<input name="nameEn" required/></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl"/></label>
        <button className="primary-button form-span" disabled={busy==="template"}>{busy==="template"?"Saving…":"Create Default Template"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Version</h2>
      <form className="catalog-form" onSubmit={createVersion}>
        <label>Template<select name="templateId" required><option value="">Select…</option>{templates.map(t=><option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}</select></label>
        <label>Language<select name="languageMode" defaultValue="BILINGUAL"><option value="BILINGUAL">Bilingual</option><option value="ENGLISH">English</option><option value="ARABIC">Arabic</option></select></label>
        <label className="form-span">Logo URL<input name="logoUrl" placeholder="https://…"/></label>
        <label>Header EN<textarea name="headerEn" rows={3}/></label><label dir="rtl">Header AR<textarea name="headerAr" dir="rtl" rows={3}/></label>
        <label>Footer EN<textarea name="footerEn" rows={3}/></label><label dir="rtl">Footer AR<textarea name="footerAr" dir="rtl" rows={3}/></label>
        <label>Watermark<input name="watermark" placeholder="CONFIDENTIAL"/></label>
        <fieldset className="form-span report-template-options"><legend>Columns & controls</legend>
          {["TEST","RESULT","FLAG","UNIT","REFERENCE"].map(key=><label key={key}><input type="checkbox" name={"col_"+key} defaultChecked/> {key}</label>)}
          <label><input type="checkbox" name="showSignature" defaultChecked/> Signature</label>
          <label><input type="checkbox" name="showQr" defaultChecked/> QR verification</label>
          <label><input type="checkbox" name="showPageNumbers" defaultChecked/> Page numbers</label>
        </fieldset>
        <label className="form-span">Change summary<input name="changeSummary" required/></label>
        <button className="primary-button form-span" disabled={busy==="version"}>{busy==="version"?"Saving…":"Create Draft Version"}</button>
      </form>
    </article>

    {message&&<div className="form-success form-span">{message}</div>}

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Template Versions</h2><span>{templates.length} templates</span></div>
      <div className="table-wrap"><table><thead><tr><th>Template</th><th>Scope</th><th>Latest</th><th>Status</th><th></th></tr></thead><tbody>
        {templates.map(t=><tr key={t.id}><td><strong>{t.code}</strong><br/><small>{t.name}</small></td><td>{t.branchId?"Branch":"Organization"}</td><td>{t.latestVersion??"—"}</td><td>{t.latestStatus??"No version"}</td><td>{t.latestVersion&&["DRAFT","APPROVED"].includes(t.latestStatus||"")?<button className="secondary-button" type="button" disabled={busy.startsWith("activate:")} onClick={()=>{
          const version=(t as Template & {latestVersionId?:string|null}).latestVersionId; if(version)void activate(t.id,version);
        }}>Activate</button>:"—"}</td></tr>)}
      </tbody></table></div>
    </article>
  </div>;
}
