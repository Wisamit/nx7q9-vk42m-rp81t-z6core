"use client";

import { useRef, useState } from "react";
import { SystemDateText } from "@/components/system-date-text";
import { validateLegacyStageReceipt } from "@/lib/legacy-stage-receipt";
import { ReviewFileUploadDialog } from "@/components/review-file-upload-dialog";
import { CatalogStageRecoveryButton } from "@/components/catalog-stage-recovery-button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { statusLabel } from "@/lib/ui-i18n";

type Batch={id:string;sourceName:string;sourceType:string;status:string;rows:number;createdAt:string};

export function LegacyImportBatches({batches,locale,page,totalPages,totalVisible}:{batches:Batch[];locale:"ar"|"en";page:number;totalPages:number;totalVisible:number}){
 const router=useRouter();
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [stageId,setStageId]=useState("");
 const [retryBlocked,setRetryBlocked]=useState(false);
 const stageAttempted=useRef(false);
 const submissionKey=useRef<string|null>(null);
 const [submittedKey,setSubmittedKey]=useState<string|null>(null);
 const processing=useRef(false);
 const tr=<T,>(en:T,ar:T)=>locale==="ar"?ar:en;

 async function stage(file:File):Promise<boolean>{
  if(processing.current || busy || stageAttempted.current || retryBlocked)return false;
  processing.current=true;
  setBusy(true);
  setMessage("");
  setStageId("");
  try{
   if(!file.name.toLowerCase().endsWith(".json") || !file.size || file.size>32*1024*1024){
    setMessage(tr("Choose a non-empty JSON file no larger than 32 MB.","اختر ملف JSON غير فارغ لا يتجاوز 32 ميغابايت."));
    return false;
   }
   const payload:unknown=JSON.parse(await file.text());
   if(!payload || typeof payload!=="object" || Array.isArray(payload) ||
      !("rows" in payload) || !Array.isArray(payload.rows) ||
      payload.rows.length===0 || payload.rows.length>20000) {
    setMessage(tr("The JSON source must contain 1–20,000 rows. Nothing was sent.",
      "يجب أن يحتوي مصدر JSON على 1 إلى 20,000 صف. لم يُرسل أي طلب."));
    return false;
   }
   const expectedRows=payload.rows.length;
   const raw=JSON.stringify(payload);
   // Each successful POST creates a new batch. A response can be lost after commit.
   submissionKey.current ??= crypto.randomUUID();
   setSubmittedKey(submissionKey.current);
   stageAttempted.current=true;
   setRetryBlocked(true);
   const response=await fetch("/api/catalog/imports",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json",
      "x-family-lab-staging-key":submissionKey.current},body:raw,
   });
   const body:unknown=await response.json().catch(()=>null);
   const receipt=response.ok?validateLegacyStageReceipt(body,expectedRows):null;
   if(!receipt){
    const serverError=body && typeof body==="object" && !Array.isArray(body) &&
      "error" in body && typeof body.error==="string" ? body.error : "";
    setMessage(tr(
      "Staging was not confirmed. The server may already have created a batch. Review current imports and audit, then reload before attempting again.",
      "لم تتأكد نتيجة التجهيز؛ ربما أنشأ الخادم دفعة بالفعل. افحص الدفعات الحالية وسجل التدقيق ثم أعد تحميل الصفحة قبل أي محاولة جديدة.",
    )+(serverError?" ("+serverError+")":""));
    return false;
   }
   setStageId(receipt.id);
   setMessage(tr(
    `Staged ${receipt.total} rows: ${receipt.valid} valid, ${receipt.warning} warnings, ${receipt.error} errors. Review batch before any commit.`,
    `تم تجهيز ${receipt.total} صفاً: ${receipt.valid} صالح، ${receipt.warning} تحذير، ${receipt.error} خطأ. راجع الدفعة قبل أي اعتماد.`,
   ));
   router.refresh();
   return true;
  }catch{
   setMessage(stageAttempted.current ? tr(
    "Connection or response interrupted after staging request. The batch may already exist. Check the import list and audit, then reload; do not blindly re-upload.",
    "انقطع الاتصال أو الرد بعد طلب التجهيز. ربما الدفعة موجودة بالفعل. افحص الدفعات والتدقيق ثم أعد التحميل؛ لا ترفع الملف مرة أخرى بشكل أعمى.",
   ) : tr(
    "Could not read or parse JSON. No staging request was sent.",
    "تعذّرت قراءة ملف JSON أو تحليله. لم يُرسل طلب تجهيز.",
   ));
   return false;
  }finally{
   processing.current=false;
   setBusy(false);
  }
 }

 return <section id="catalog-import-batches" className="table-card import-card">
  <div className="table-toolbar">
   <div>
    <h2>{tr("Legacy Catalog Migration","ترحيل دليل النظام القديم")}</h2>
    <span>{tr("Controlled staging from the cleaned Family Lab MDB. Nothing is written directly into the live catalog.","تجهيز مضبوط للبيانات القادمة من ملف Family Lab MDB المنظف، من دون الكتابة مباشرة في دليل النظام الفعلي.")}</span>
   </div>
   <div className="import-actions">
    <ReviewFileUploadDialog locale={locale} busy={busy} retryBlocked={retryBlocked} error={message}
        onResetError={() => setMessage("")}
      title={tr("Stage legacy catalog source", "تجهيز مصدر الدليل القديم")}
      description={tr("Upload only a cleaned JSON master-data export. No raw MDB or patient records.", "ارفع ملف JSON منظّف للبيانات الرئيسية فقط، دون ملفات MDB الأصلية أو بيانات المرضى.")}
      triggerLabel={tr("Stage MDB Export", "تجهيز تصدير MDB")}
      accept=".json,application/json"
      fileHint={tr("JSON only, maximum 32 MB. Inspect the staged rows before any governed commit.", "ملف JSON فقط بحد أقصى 32 ميغابايت. راجع الصفوف قبل أي اعتماد مضبوط.")}
      onStage={stage} />
    <span className="status-pill">{totalVisible} {tr("accessible batch(es)","دفعة متاحة")}</span>
   </div>
  </div>
  {message&&<p className="import-message" role={stageId?"status":"alert"}>{message}</p>}
  {stageId&&<p><Link className="table-link" href={`/catalog/imports/${stageId}`}>
    {tr("Open the newly staged batch for validation review","افتح الدفعة الجديدة لمراجعة التحقق")}
  </Link></p>}
  {retryBlocked&&!stageId&&<CatalogStageRecoveryButton locale={locale} sourceType="LEGACY_MDB_EXPORT" submissionKey={submittedKey} />}
  {retryBlocked&&!stageId&&<p className="form-warning" role="alert">{tr(
    "Do not repeat this upload without checking the latest batch and audit. Reload after review.",
    "لا تكرر رفع الملف قبل مراجعة أحدث دفعة وسجل التدقيق. أعد تحميل الصفحة بعد التحقق.",
  )}</p>}
  {batches.length===0?
   <div className="import-empty"><strong>{tr("Import staging is ready.","تجهيز الاستيراد جاهز.")}</strong><p>{tr("Export the legacy master data, stage the JSON here, then review warnings before committing anything to the live catalog.","صدّر البيانات الرئيسية من النظام القديم، جهّز ملف JSON هنا، ثم راجع التحذيرات قبل اعتماد أي بيانات في الدليل الفعلي.")}</p></div>:
   <div className="table-wrap"><table><thead><tr><th>{tr("Source","المصدر")}</th><th>{tr("Type","النوع")}</th><th>{tr("Rows","الصفوف")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Created","تاريخ الإنشاء")}</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td><Link className="table-link" href={`/catalog/imports/${b.id}`}><strong>{b.sourceName}</strong></Link></td><td>{b.sourceType}</td><td>{b.rows}</td><td>{statusLabel(locale,b.status)}</td><td><SystemDateText value={b.createdAt} kind="instant-date" /></td></tr>)}</tbody></table></div>}
  {totalPages>1&&<nav className="pagination-nav" aria-label={tr("Import batch pages","صفحات دفعات الاستيراد")}>
   {page>1?<Link className="secondary-link" href={`/catalog?importPage=${page-1}#catalog-import-batches`}>{tr("Previous","السابق")}</Link>:<span className="muted">{tr("Previous","السابق")}</span>}
   <span aria-live="polite">{tr(`Page ${page} of ${totalPages}`,`الصفحة ${page} من ${totalPages}`)}</span>
   {page<totalPages?<Link className="secondary-link" href={`/catalog?importPage=${page+1}#catalog-import-batches`}>{tr("Next","التالي")}</Link>:<span className="muted">{tr("Next","التالي")}</span>}
  </nav>}
 </section>;
}
