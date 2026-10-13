"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type KindCount={entityType:string;total:number;imported:number;unresolved:number;skipped:number};
type Finding={code:string;count:number;severity:"BLOCK"|"REVIEW"|"INFO"};
type LedgerItem={
  id:string;sourceType:string;sourceName:string;sourceChecksumPresent:boolean;status:string;
  createdAt:string;validatedAt:string|null;importedAt:string|null;
  total:number;imported:number;skipped:number;unresolved:number;deferred:number;errors:number;
  state:"BLOCKED"|"REVIEW_REQUIRED"|"RECORDED_ONLY";findings:Finding[];byType:KindCount[];
};
type Reply={items?:LedgerItem[];nextCursor?:string|null;error?:string};
export function LegacyImportReconciliationLedger({locale}:{locale:"ar"|"en"}){
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [items,setItems]=useState<LedgerItem[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [started,setStarted]=useState(false);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  async function load(next:string|null,replace=false){
    setLoading(true);setMessage("");
    try{
      const response=await fetch("/api/catalog/imports/reconciliation-ledger"+
        (next?"?cursor="+encodeURIComponent(next):""),{cache:"no-store"});
      const result=await response.json() as Reply;
      if(!response.ok)throw Error(result.error||"request_failed");
      setItems(prev=>replace?result.items||[]:[...prev,...(result.items||[])]);
      setCursor(result.nextCursor||null);
      setStarted(true);
    }catch(e){setMessage(tr("Unable to load import ledger: ","تعذر تحميل سجل الترحيل: ")+
      (e instanceof Error?e.message:"unknown"));}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load(null,true);},[]); // one initial read; details are fetched on demand by clicking load more
  const total=items.reduce((n,x)=>n+x.total,0);
  const pending=items.reduce((n,x)=>n+x.unresolved,0);
  const imported=items.reduce((n,x)=>n+x.imported,0);
  const blocked=items.filter(x=>x.state==="BLOCKED").length;
  const findingLabel=(code:string)=>{
    const labels:Record<string,[string,string]>={
      SOURCE_CHECKSUM_MISSING:["Missing source checksum","بصمة المصدر غير محفوظة"],
      NO_SOURCE_ROWS_RECORDED:["No source rows recorded","لم تُسجّل صفوف للمصدر"],
      REVIEW_ONLY_SOURCE_NOT_COMMITTED:["Review-only batch, not production import","دفعة مراجعة فقط ولم تُرحَّل للإنتاج"],
      BATCH_NOT_IMPORTED:["Batch has not reached imported status","الدفعة لم تصل إلى حالة الاستيراد"],
      UNRESOLVED_STAGED_ROWS:["Staged rows still unresolved","صفوف تجهيز لم تُحسم بعد"],
      ROWS_WITH_VALIDATION_ERRORS:["Validation errors","أخطاء تحقق"],
      SKIPPED_ROWS_REQUIRE_RECONCILIATION:["Skipped records need source reconciliation","الصفوف المتجاوزة تحتاج مطابقة مع المصدر"],
      IMPORTED_BATCH_WITHOUT_IMPORTED_ROWS:["Imported batch without imported rows","دفعة مكتملة دون صفوف مستوردة"],
      VALIDATION_TIMESTAMP_MISSING:["Validation timestamp not recorded","تاريخ التحقق غير محفوظ"],
    };
    return tr(...(labels[code]||[code,code]));
  };
  return <section className="detail-section" dir={locale==="ar"?"rtl":"ltr"}>
    <div className="catalog-stats">
      <article><strong>{items.length}</strong><span>{tr("Loaded batches","دفعات محمّلة")}</span></article>
      <article><strong>{total}</strong><span>{tr("Source rows on loaded pages","صفوف المصدر المحمّلة")}</span></article>
      <article><strong>{imported}</strong><span>{tr("Imported rows","صفوف مستوردة")}</span></article>
      <article><strong>{pending}</strong><span>{tr("Unresolved rows","صفوف غير محسومة")}</span></article>
      <article><strong>{blocked}</strong><span>{tr("Blocked batches on loaded pages","دفعات محجوبة في الصفحات المحمّلة")}</span></article>
    </div>
    <p className="muted">{tr(
      "This ledger shows recorded staging batches only. It cannot certify that every Access row was extracted, nor that clinical intervals or prices were approved. Counts are for loaded pages, not the entire organization.",
      "هذه اللوحة تعرض دفعات التجهيز المسجّلة فقط؛ لا تثبت استخراج جميع سجلات Access ولا اعتماد المجالات المرجعية أو الأسعار طبياً ومالياً. المجاميع تخص الصفحات المحمّلة وليست كل المؤسسة."
    )}</p>
    {message&&<p role="status">{message}</p>}
    <div className="table-card">
      <div className="table-toolbar"><h2>{tr("Recorded import batches and exceptions","دفعات الترحيل المسجلة والاستثناءات")}</h2>
        <button className="secondary-button" type="button" disabled={loading} onClick={()=>void load(null,true)}>
          {tr("Refresh","تحديث")}</button>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th>{tr("Source","المصدر")}</th><th>{tr("Batch","الدفعة")}</th>
        <th>{tr("Recorded rows","الصفوف")}</th><th>{tr("Imported","المستوردة")}</th>
        <th>{tr("Unresolved","غير المحسومة")}</th><th>{tr("Skipped","المتجاوزة")}</th>
        <th>{tr("Reconciliation status","حالة المطابقة")}</th><th>{tr("Review","المراجعة")}</th>
      </tr></thead><tbody>{items.map(item=><tr key={item.id}>
        <td><strong>{item.sourceName}</strong><small>{item.sourceType}</small></td>
        <td>{item.status}<small>{item.createdAt.slice(0,10)}</small></td>
        <td>{item.total}</td><td>{item.imported}</td><td>{item.unresolved}</td><td>{item.skipped}</td>
        <td>{item.state==="BLOCKED"?tr("Blocked","محجوبة"):
          item.state==="REVIEW_REQUIRED"?tr("Needs review","تحتاج مراجعة"):tr("Recorded only","مسجّلة فقط")}</td>
        <td><div className="inline-actions">
          <button className="secondary-button" type="button"
            onClick={()=>setExpanded(current=>({...current,[item.id]:!current[item.id]}))}>
            {expanded[item.id]?tr("Hide","إخفاء"):tr("Details","التفاصيل")}
          </button>
          <Link className="secondary-link" href={"/catalog/imports/"+item.id}>{tr("Open batch","فتح الدفعة")}</Link>
        </div>
          {expanded[item.id]&&<div className="detail-section">
            <p>{tr("Checksum available: ","بصمة المصدر متاحة: ")}{item.sourceChecksumPresent?tr("Yes","نعم"):tr("No","لا")}</p>
            <p>{tr("Validated: ","وقت التحقق: ")}{item.validatedAt||"—"}</p>
            <p>{tr("Imported at: ","وقت الاستيراد: ")}{item.importedAt||"—"}</p>
            <p>{tr("Deferred candidate rows: ","صفوف مرشحة مؤجلة: ")}{item.deferred}</p>
            <ul>{item.findings.map((f,index)=><li key={index}>{findingLabel(f.code)} — {f.count} ({f.severity})</li>)}</ul>
            <ul>{item.byType.map(t=><li key={t.entityType}>{t.entityType}: {t.total} ·
              {tr(" imported "," مستوردة ")}{t.imported} · {tr(" unresolved "," غير محسومة ")}{t.unresolved} ·
              {tr(" skipped "," متجاوزة ")}{t.skipped}</li>)}</ul>
          </div>}
        </td>
      </tr>)}</tbody></table></div>
      {started&&items.length===0&&<p className="muted">{tr("No visible import batches recorded.","لا توجد دفعات ترحيل مرئية ومسجلة.")}</p>}
      {cursor&&<button type="button" className="secondary-button" disabled={loading}
        onClick={()=>void load(cursor)}>{tr("Load more batches","تحميل دفعات إضافية")}</button>}
    </div>
  </section>;
}
