"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";
import { useUiLocale } from "@/components/ui-locale-provider";
import { statusLabel } from "@/lib/ui-i18n";

type Branch = { id:string; code:string; name:string };
type Template = { id:string; code:string; name:string; branchId:string|null; latestVersion:number|null; latestStatus:string|null; latestVersionId:string|null };

export function ReportTemplateManager({ branches, templates }: { branches:Branch[]; templates:Template[] }) {
  const router=useRouter();
  const {locale,t}=useUiLocale();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [open,setOpen]=useState<"template"|"version"|"">("");

  async function createTemplate(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); setBusy("template"); setMessage("");
    const f=new FormData(event.currentTarget);
    const response=await fetch("/api/report-templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:f.get("code"),nameEn:f.get("nameEn"),nameAr:f.get("nameAr"),branchId:f.get("branchId")||null,isDefault:true,
    })});
    setBusy(""); setMessage(response.ok?t("Template created.","تم إنشاء القالب."):t("Template creation failed.","تعذر إنشاء القالب."));
    if(response.ok){event.currentTarget.reset();router.refresh();setOpen("");}
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
    setBusy(""); setMessage(response.ok?t("Draft version created.","تم إنشاء نسخة مسودة."):t("Version creation failed.","تعذر إنشاء النسخة."));
    if(response.ok){event.currentTarget.reset();router.refresh();setOpen("");}
  }

  async function activate(templateId:string,versionId:string){
    setBusy("activate:"+versionId);setMessage("");
    const response=await fetch(`/api/report-templates/${templateId}/versions/${versionId}/activate`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    setBusy("");setMessage(response.ok?t("Template version is now effective.","أصبحت نسخة القالب فعالة."):t("Activation failed.","تعذر التفعيل."));
    if(response.ok)router.refresh();
  }

  return <>
    <div className="crud-action-bar">
      <div>{message&&<span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" onClick={()=>{setMessage("");setOpen("template")}}><SystemIcon name="plus" size={16}/>{t("New Template","قالب جديد")}</button>
        <button type="button" className="secondary-button" onClick={()=>{setMessage("");setOpen("version")}}><SystemIcon name="plus" size={16}/>{t("New Version","نسخة جديدة")}</button>
      </div>
    </div>

    <CrudModal open={open==="template"} onClose={()=>setOpen("")} title={t("Create Report Template","إنشاء قالب تقرير")} description={t("Create the organization or branch template identity.","أنشئ هوية قالب على مستوى المؤسسة أو الفرع.")} size="lg">
      <form className="catalog-form" onSubmit={createTemplate}>
        <label>{t("Code","الرمز")}<input name="code" required placeholder="DEFAULT_REPORT"/></label>
        <label>{t("Branch","الفرع")}<select name="branchId"><option value="">{t("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>
        <label>{t("Name (English)","الاسم بالإنجليزية")}<input name="nameEn" required/></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl"/></label>
        <button className="primary-button form-span" disabled={busy==="template"}>{busy==="template"?t("Saving…","جارٍ الحفظ…"):t("Create Default Template","إنشاء القالب الافتراضي")}</button>
        {message&&<div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open==="version"} onClose={()=>setOpen("")} title={t("Create Report Template Version","إنشاء نسخة من قالب التقرير")} description={t("Create a controlled draft version without changing historical released reports.","أنشئ نسخة مسودة مضبوطة دون تغيير التقارير التاريخية الصادرة.")} size="xl">
      <form className="catalog-form" onSubmit={createVersion}>
        <label>{t("Template","القالب")}<select name="templateId" required><option value="">{t("Select…","اختر…")}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}</select></label>
        <label>{t("Language","اللغة")}<select name="languageMode" defaultValue="BILINGUAL"><option value="BILINGUAL">{t("Bilingual","ثنائي اللغة")}</option><option value="ENGLISH">{t("English","الإنجليزية")}</option><option value="ARABIC">{t("Arabic","العربية")}</option></select></label>
        <label className="form-span">{t("Logo URL","رابط الشعار")}<input name="logoUrl" placeholder="https://…"/></label>
        <label>{t("Header EN","ترويسة إنجليزية")}<textarea name="headerEn" rows={3}/></label><label dir="rtl">{t("Header AR","ترويسة عربية")}<textarea name="headerAr" dir="rtl" rows={3}/></label>
        <label>{t("Footer EN","تذييل إنجليزي")}<textarea name="footerEn" rows={3}/></label><label dir="rtl">{t("Footer AR","تذييل عربي")}<textarea name="footerAr" dir="rtl" rows={3}/></label>
        <label>{t("Watermark","العلامة المائية")}<input name="watermark" placeholder="CONFIDENTIAL"/></label>
        <fieldset className="form-span report-template-options"><legend>{t("Columns & controls","الأعمدة وخيارات العرض")}</legend>
          {["TEST","RESULT","FLAG","UNIT","REFERENCE"].map(key=><label key={key}><input type="checkbox" name={"col_"+key} defaultChecked/> {key}</label>)}
          <label><input type="checkbox" name="showSignature" defaultChecked/> {t("Signature","التوقيع")}</label>
          <label><input type="checkbox" name="showQr" defaultChecked/> {t("QR verification","تحقق QR")}</label>
          <label><input type="checkbox" name="showPageNumbers" defaultChecked/> {t("Page numbers","أرقام الصفحات")}</label>
        </fieldset>
        <label className="form-span">{t("Change summary","ملخص التغيير")}<input name="changeSummary" required/></label>
        <button className="primary-button form-span" disabled={busy==="version"}>{busy==="version"?t("Saving…","جارٍ الحفظ…"):t("Create Draft Version","إنشاء نسخة مسودة")}</button>
        {message&&<div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <article className="table-card">
      <div className="table-toolbar"><h2>{t("Template Versions","نسخ القوالب")}</h2><span>{templates.length} {t("templates","قالب")}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{t("Template","القالب")}</th><th>{t("Scope","النطاق")}</th><th>{t("Latest","الأحدث")}</th><th>{t("Status","الحالة")}</th><th></th></tr></thead><tbody>
        {templates.map(t=><tr key={t.id}><td><strong>{t.code}</strong><br/><small>{t.name}</small></td><td>{t.branchId?t("Branch","فرع"):t("Organization","المؤسسة")}</td><td>{t.latestVersion??"—"}</td><td>{t.latestStatus?statusLabel(locale,t.latestStatus):t("No version","لا توجد نسخة")}</td><td>{t.latestVersion&&["DRAFT","APPROVED"].includes(t.latestStatus||"")?<button className="secondary-button" type="button" disabled={busy.startsWith("activate:")} onClick={()=>{const version=t.latestVersionId;if(version)void activate(t.id,version)}}>{t("Activate","تفعيل")}</button>:"—"}</td></tr>)}
      </tbody></table></div>
    </article>
  </>;
}
