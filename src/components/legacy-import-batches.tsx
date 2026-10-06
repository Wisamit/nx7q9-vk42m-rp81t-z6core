"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUiLocale } from "@/components/ui-locale-provider";
import { statusLabel } from "@/lib/ui-i18n";

type Batch={id:string;sourceName:string;sourceType:string;status:string;rows:number;createdAt:string};
export function LegacyImportBatches({batches}:{batches:Batch[]}){
 const router=useRouter(); const {locale,t}=useUiLocale(); const input=useRef<HTMLInputElement>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 async function stage(file:File){setBusy(true);setMessage("");try{const payload=JSON.parse(await file.text());const r=await fetch("/api/catalog/imports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const body=await r.json();if(!r.ok)throw new Error(body.error||t("Import validation failed.","فشل التحقق من ملف الاستيراد.")); setMessage(`${t("Staged","تم تجهيز")} ${body.summary.total} ${t("rows","صفًا")}: ${body.summary.VALID||0} ${t("valid","صحيح")}, ${body.summary.WARNING||0} ${t("warnings","تحذير")}, ${body.summary.ERROR||0} ${t("errors","خطأ")}.`);router.refresh()}catch(e){setMessage(e instanceof Error?e.message:t("Could not stage export.","تعذر تجهيز ملف التصدير."))}finally{setBusy(false);if(input.current)input.current.value=""}}
 return <section className="table-card import-card"><div className="table-toolbar"><div><h2>{t("Legacy Catalog Migration", "ترحيل دليل النظام القديم")}</h2><span>{t("Controlled staging from the cleaned Family Lab MDB. Nothing is written directly into the live catalog.", "تجهيز مضبوط من ملف Family Lab MDB المنظف، ولا تتم كتابة أي شيء مباشرة في الدليل الحي.")}</span></div><div className="import-actions"><input ref={input} hidden type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void stage(f)}}/><button className="secondary-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?t("Validating…","جارٍ التحقق…"):t("Stage MDB Export","تجهيز تصدير MDB")}</button><span className="status-pill">{batches.length} {t("batch(es)","دفعة")}</span></div></div>
 {message&&<p className="import-message">{message}</p>}
 {batches.length===0?<div className="import-empty"><strong>{t("Import staging is ready.", "بيئة تجهيز الاستيراد جاهزة.")}</strong><p>{t("Export the legacy master data, stage the JSON here, then review warnings before committing anything to the live catalog.", "صدّر البيانات الأساسية القديمة، جهّز ملف JSON هنا، ثم راجع التحذيرات قبل اعتماد أي شيء في الدليل الحي.")}</p></div>:<div className="table-wrap"><table><thead><tr><th>{t("Source","المصدر")}</th><th>{t("Type","النوع")}</th><th>{t("Rows","الصفوف")}</th><th>{t("Status","الحالة")}</th><th>{t("Created","تاريخ الإنشاء")}</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td><Link className="table-link" href={`/catalog/imports/${b.id}`}><strong>{b.sourceName}</strong></Link></td><td>{b.sourceType}</td><td>{b.rows}</td><td>{statusLabel(locale,b.status)}</td><td>{b.createdAt.slice(0,10)}</td></tr>)}</tbody></table></div>}
 </section>
}
