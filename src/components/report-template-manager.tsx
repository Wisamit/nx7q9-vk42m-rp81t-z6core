"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";
import { statusLabel } from "@/lib/ui-i18n";

type Branch = { id:string; code:string; nameEn:string; nameAr:string|null };
type Template = { id:string; code:string; nameEn:string; nameAr:string|null; branchId:string|null; latestVersion:number|null; latestStatus:string|null; latestVersionId:string|null; latestSubmittedByUserId:string|null };

export function ReportTemplateManager({ branches, templates, locale, currentUserId, canManage }: { branches:Branch[]; templates:Template[]; locale:"ar"|"en"; currentUserId:string; canManage:boolean }) {
  const router=useRouter();
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [open,setOpen]=useState<"template"|"version"|"">("");
  const [decision,setDecision]=useState<{templateId:string;versionId:string;action:"APPROVE"|"ACTIVATE"}|null>(null);
  const [decisionReason,setDecisionReason]=useState("");
  const [formError,setFormError]=useState("");
  const tr=<T,>(en:T,ar:T)=>locale==="ar"?ar:en;
  const branchName=(branch:Branch)=>locale==="ar"?branch.nameAr||branch.nameEn:branch.nameEn;
  const templateName=(template:Template)=>locale==="ar"?template.nameAr||template.nameEn:template.nameEn;
  const columnLabel=(key:string)=>{
    const labels:Record<string,[string,string]>={
      TEST:["Test","الفحص"],RESULT:["Result","النتيجة"],FLAG:["Flag","الإشارة"],UNIT:["Unit","الوحدة"],REFERENCE:["Reference","المجال المرجعي"]
    };
    const label=labels[key];
    return label?tr(label[0],label[1]):key;
  };

  async function createTemplate(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); setBusy("template"); setMessage("");
    const f=new FormData(event.currentTarget);
    const response=await fetch("/api/report-templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      code:f.get("code"),nameEn:f.get("nameEn"),nameAr:f.get("nameAr"),branchId:f.get("branchId")||null,isDefault:true,
    })});
    setBusy(""); setMessage(response.ok?tr("Template created.","تم إنشاء القالب."):tr("Template creation failed.","فشل إنشاء القالب."));
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
    setBusy(""); setMessage(response.ok?tr("Draft version created.","تم إنشاء نسخة مسودة."):tr("Version creation failed.","فشل إنشاء النسخة."));
    if(response.ok){event.currentTarget.reset();router.refresh();setOpen("");}
  }

  function reviewVersion(templateId: string, versionId: string, action: "APPROVE" | "ACTIVATE") {
    if (busy || !canManage) return;
    const row = templates.find(template => template.id === templateId);
    if (!row || row.latestVersionId !== versionId) return;
    if (action === "APPROVE" && (row.latestStatus !== "DRAFT" || row.latestSubmittedByUserId === currentUserId)) return;
    if (action === "ACTIVATE" && row.latestStatus !== "APPROVED") return;
    setFormError("");
    setMessage("");
    setDecisionReason("");
    setDecision({ templateId, versionId, action });
  }

  async function confirmVersionDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || busy || !canManage) return;
    const { templateId, versionId, action } = decision;
    const row = templates.find(template => template.id === templateId);
    if (!row || row.latestVersionId !== versionId ||
      (action === "APPROVE" && (row.latestStatus !== "DRAFT" || row.latestSubmittedByUserId === currentUserId)) ||
      (action === "ACTIVATE" && row.latestStatus !== "APPROVED")) {
      setFormError(tr("The template version has changed. Refresh before retrying.",
        "تغيّرت حالة إصدار القالب؛ حدّث الصفحة قبل إعادة المحاولة."));
      return;
    }
    if (action === "APPROVE" && decisionReason.trim().length < 12) {
      setFormError(tr("Independent review reason must contain at least 12 characters.",
        "يجب أن يحتوي سبب المراجعة المستقلة على 12 محرفاً على الأقل."));
      return;
    }
    setBusy(action.toLowerCase()+":"+versionId);
    setFormError("");
    try {
      const endpoint = action === "APPROVE" ? "approve" : "activate";
      const response = await fetch(`/api/report-templates/${templateId}/versions/${versionId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "APPROVE"
          ? {reason: decisionReason.trim(), confirmation: "APPROVE_EXACT_REPORT_LAYOUT_VERSION"}
          : {}),
      });
      const data = await response.json().catch(() => ({})) as {error?:string};
      if (!response.ok) {
        setFormError(data.error || tr("Could not update this report template version.",
          "تعذر تحديث هذا الإصدار من قالب التقرير."));
        return;
      }
      setMessage(action === "APPROVE"
        ? tr("Version independently approved.", "تم اعتماد النسخة من مراجع مستقل.")
        : tr("Template version is now effective.", "أصبحت نسخة القالب سارية الآن."));
      setDecision(null);
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted. Verify the template status before retrying.",
        "انقطع الاتصال؛ تحقق من حالة القالب قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
  }

  return <>
    <div className="crud-action-bar">
      <div>{message&&<span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" disabled={!canManage || !!busy} onClick={()=>{setMessage("");setOpen("template")}}><SystemIcon name="plus" size={16}/>{tr("New Template","قالب جديد")}</button>
        <button type="button" className="secondary-button" disabled={!canManage || !!busy} onClick={()=>{setMessage("");setOpen("version")}}><SystemIcon name="plus" size={16}/>{tr("New Version","نسخة جديدة")}</button>
      </div>
    </div>

    <CrudModal open={open==="template"} onClose={()=>{if(!busy)setOpen("");}} title={tr("Create Report Template","إنشاء قالب تقرير")} description={tr("Create the organization or branch template identity.","أنشئ هوية قالب على مستوى المؤسسة أو الفرع.")} size="compact">
      {open==="template"&&<form className="catalog-form" onSubmit={createTemplate}>
        <label>{tr("Code","الرمز")}<input name="code" required placeholder="DEFAULT_REPORT"/></label>
        <label>{tr("Branch","الفرع")}<select name="branchId"><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {branchName(b)}</option>)}</select></label>
        <label>{tr("Name (English)","الاسم بالإنجليزية")}<input name="nameEn" required/></label>
        <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl"/></label>
        <button className="primary-button form-span" disabled={busy==="template"}>{busy==="template"?tr("Saving…","جارٍ الحفظ…"):tr("Create Default Template","إنشاء القالب الافتراضي")}</button>
        {message&&<div className="form-success form-span">{message}</div>}
      </form>}
    </CrudModal>

    <CrudModal open={open==="version"} onClose={()=>setOpen("")} title={tr("Create Report Template Version","إنشاء نسخة من قالب التقرير")} description={tr("Create a controlled draft version without changing historical released reports.","أنشئ نسخة مسودة مضبوطة من دون تغيير التقارير التاريخية الصادرة.")} size="compact">
      {open==="version"&&<form className="catalog-form" onSubmit={createVersion}>
        <label>{tr("Template","القالب")}<select name="templateId" required><option value="">{tr("Select…","اختر…")}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.code} — {templateName(t)}</option>)}</select></label>
        <label>{tr("Language","اللغة")}<select name="languageMode" defaultValue="BILINGUAL"><option value="BILINGUAL">{tr("Bilingual","ثنائي اللغة")}</option><option value="ENGLISH">{tr("English","الإنجليزية")}</option><option value="ARABIC">{tr("Arabic","العربية")}</option></select></label>
        <label className="form-span">{tr("Logo URL","رابط الشعار")}<input name="logoUrl" placeholder="https://…"/></label>
        <label>{tr("Header (English)","الترويسة بالإنجليزية")}<textarea name="headerEn" rows={3}/></label><label>{tr("Header (Arabic)","الترويسة بالعربية")}<textarea name="headerAr" dir="rtl" rows={3}/></label>
        <label>{tr("Footer (English)","التذييل بالإنجليزية")}<textarea name="footerEn" rows={3}/></label><label>{tr("Footer (Arabic)","التذييل بالعربية")}<textarea name="footerAr" dir="rtl" rows={3}/></label>
        <label>{tr("Watermark","العلامة المائية")}<input name="watermark" placeholder={tr("CONFIDENTIAL","سري")}/></label>
        <fieldset className="form-span report-template-options"><legend>{tr("Columns & controls","الأعمدة وعناصر التحكم")}</legend>
          {["TEST","RESULT","FLAG","UNIT","REFERENCE"].map(key=><label key={key}><input type="checkbox" name={"col_"+key} defaultChecked/> {columnLabel(key)}</label>)}
          <label><input type="checkbox" name="showSignature" defaultChecked/> {tr("Signature","التوقيع")}</label>
          <label><input type="checkbox" name="showQr" defaultChecked/> {tr("QR verification","التحقق عبر QR")}</label>
          <label><input type="checkbox" name="showPageNumbers" defaultChecked/> {tr("Page numbers","ترقيم الصفحات")}</label>
        </fieldset>
        <label className="form-span">{tr("Change summary","ملخص التغيير")}<input name="changeSummary" required/></label>
        <button className="primary-button form-span" disabled={busy==="version"}>{busy==="version"?tr("Saving…","جارٍ الحفظ…"):tr("Create Draft Version","إنشاء نسخة مسودة")}</button>
        {message&&<div className="form-success form-span">{message}</div>}
      </form>}
    </CrudModal>

    <article className="table-card">
      <div className="table-toolbar"><h2>{tr("Template Versions","نسخ القوالب")}</h2><span>{templates.length} {tr("templates","قوالب")}</span></div>
      <p className="muted">{tr("A different authorized user must approve a draft before immediate activation. Past released reports and retired template intervals remain unchanged.", "يجب أن يعتمد المسودة مستخدم مخوّل آخر قبل تفعيلها فوراً. تبقى التقارير الصادرة وفترات القوالب السابقة محفوظة.")}</p>
      <div className="table-wrap"><table><thead><tr><th>{tr("Template","القالب")}</th><th>{tr("Scope","النطاق")}</th><th>{tr("Latest","الأحدث")}</th><th>{tr("Status","الحالة")}</th><th></th></tr></thead><tbody>
        {templates.map(t=><tr key={t.id}><td><strong>{t.code}</strong><br/><small>{templateName(t)}</small></td><td>{t.branchId?tr("Branch","فرع"):tr("Organization","المؤسسة")}</td><td>{t.latestVersion??"—"}</td><td>{t.latestStatus?statusLabel(locale,t.latestStatus):tr("No version","لا توجد نسخة")}</td><td>{canManage&&t.latestVersion&&t.latestStatus==="DRAFT"&&t.latestSubmittedByUserId!==currentUserId?
          <button className="secondary-button" type="button" disabled={!!busy}
            onClick={()=>{const version=t.latestVersionId;if(version)reviewVersion(t.id,version,"APPROVE")}}>
            {tr("Approve independently","اعتماد مستقل")}
          </button>:canManage&&t.latestVersion&&t.latestStatus==="APPROVED"?
          <button className="secondary-button" type="button" disabled={!!busy}
            onClick={()=>{const version=t.latestVersionId;if(version)reviewVersion(t.id,version,"ACTIVATE")}}>
            {tr("Activate now","تفعيل الآن")}
          </button>:"—"}</td></tr>)}
      </tbody></table></div>
    </article>
    <CrudModal open={decision!==null} onClose={()=>{if(!busy)setDecision(null);}}
      size="compact"
      title={decision?.action==="APPROVE"
        ? tr("Independent Report Layout Approval","الاعتماد المستقل لتصميم التقرير")
        : tr("Activate Approved Report Template","تفعيل قالب التقرير المعتمد")}
      description={tr(
        "Review the exact version and organization/branch scope. Earlier released clinical reports remain immutable.",
        "راجع الإصدار المحدد ونطاق المؤسسة أو الفرع؛ التقارير السريرية الصادرة سابقاً تبقى دون تغيير.",
      )}>
      {decision&&<form className="catalog-form" onSubmit={confirmVersionDecision}>
        {(() => {
          const item=templates.find(template=>template.id===decision.templateId);
          return <div className="form-span">
            <strong>{item?.code||tr("Unknown template","قالب غير معروف")}</strong>
            <p>{tr("Version","الإصدار")}: {item?.latestVersion??"—"} ·
              {tr("Scope","النطاق")}: {item?.branchId?tr("Branch","الفرع"):tr("Organization","المؤسسة")}</p>
          </div>;
        })()}
        {decision.action==="APPROVE"&&<label className="form-span">
          {tr("Independent layout review: language, columns, signature, QR, branding (minimum 12 characters)",
            "المراجعة المستقلة للغة والأعمدة والتوقيع وQR والهوية (12 محرفاً على الأقل)")}
          <textarea required minLength={12} maxLength={2000} rows={4}
            value={decisionReason} onChange={event=>setDecisionReason(event.target.value)}/>
        </label>}
        {decision.action==="ACTIVATE"&&<p className="muted form-span">
          {tr("This changes only future report rendering. Previously released report snapshots and historical versions are not edited.",
            "يغيّر هذا طريقة عرض التقارير المستقبلية فقط؛ لا يعدّل لقطات التقارير الصادرة أو الإصدارات التاريخية.")}
        </p>}
        {formError&&<p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span"
          disabled={Boolean(busy)||(decision.action==="APPROVE"&&decisionReason.trim().length<12)}>
          {decision.action==="APPROVE"?tr("Confirm independent approval","تأكيد الاعتماد المستقل")
            :tr("Confirm activation","تأكيد التفعيل")}
        </button>
      </form>}
    </CrudModal>
  </>;
}
