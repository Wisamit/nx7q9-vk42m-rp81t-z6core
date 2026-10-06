"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { statusLabel } from "@/lib/ui-i18n";

type Batch={id:string;sourceName:string;sourceType:string;status:string;rows:number;createdAt:string};

export function LegacyImportBatches({batches,locale}:{batches:Batch[];locale:"ar"|"en"}){
 const router=useRouter();
 const input=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const tr=<T,>(en:T,ar:T)=>locale==="ar"?ar:en;

 async function stage(file:File){
  setBusy(true);setMessage("");
  try{
   const payload=JSON.parse(await file.text());
   const r=await fetch("/api/catalog/imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const body=await r.json();
   if(!r.ok)throw new Error("stage_failed");
   setMessage(tr(
    `Staged ${body.summary.total} rows: ${body.summary.VALID||0} valid, ${body.summary.WARNING||0} warnings, ${body.summary.ERROR||0} errors.`,
    `تم تجهيز ${body.summary.total} صفًا: ${body.summary.VALID||0} صالح، ${body.summary.WARNING||0} تحذيرات، ${body.summary.ERROR||0} أخطاء.`
   ));
   router.refresh();
  }catch{
   setMessage(tr("Could not validate or stage the export.","تعذر التحقق من ملف التصدير أو تجهيزه."));
  }finally{
   setBusy(false);
   if(input.current)input.current.value="";
  }
 }

 return <section className="table-card import-card">
  <div className="table-toolbar">
   <div>
    <h2>{tr("Legacy Catalog Migration","ترحيل دليل النظام القديم")}</h2>
    <span>{tr("Controlled staging from the cleaned Family Lab MDB. Nothing is written directly into the live catalog.","تجهيز مضبوط للبيانات القادمة من ملف Family Lab MDB المنظف، من دون الكتابة مباشرة في دليل النظام الفعلي.")}</span>
   </div>
   <div className="import-actions">
    <input ref={input} hidden type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void stage(f)}}/>
    <button className="secondary-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?tr("Validating…","جارٍ التحقق…"):tr("Stage MDB Export","تجهيز تصدير MDB")}</button>
    <span className="status-pill">{batches.length} {tr("batch(es)","دفعة")}</span>
   </div>
  </div>
  {message&&<p className="import-message">{message}</p>}
  {batches.length===0?
   <div className="import-empty"><strong>{tr("Import staging is ready.","تجهيز الاستيراد جاهز.")}</strong><p>{tr("Export the legacy master data, stage the JSON here, then review warnings before committing anything to the live catalog.","صدّر البيانات الرئيسية من النظام القديم، جهّز ملف JSON هنا، ثم راجع التحذيرات قبل اعتماد أي بيانات في الدليل الفعلي.")}</p></div>:
   <div className="table-wrap"><table><thead><tr><th>{tr("Source","المصدر")}</th><th>{tr("Type","النوع")}</th><th>{tr("Rows","الصفوف")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Created","تاريخ الإنشاء")}</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td><Link className="table-link" href={`/catalog/imports/${b.id}`}><strong>{b.sourceName}</strong></Link></td><td>{b.sourceType}</td><td>{b.rows}</td><td>{statusLabel(locale,b.status)}</td><td>{b.createdAt.slice(0,10)}</td></tr>)}</tbody></table></div>}
 </section>;
}
