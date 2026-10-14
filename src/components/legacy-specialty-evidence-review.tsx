"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";

type PairReview={
  prefix:string;lowColumn:string;highColumn:string;observationCount:number;
  incompleteBounds:number;invertedBounds:number;unknownSelectors:number;
  matchStatus:"EXACT_COMPONENT_CODE"|"NO_EXACT_CODE_MATCH"|"AMBIGUOUS_CODE";
  matchedComponentCode:string|null;
};
type TableReview={tableName:string;pairingComplete:boolean;warnings:string[];pairs:PairReview[]};
type Review={
  status:"review_only";sourceName:string;sourceSha256:string;fileFingerprint:string;
  tableCount:number;totalCandidatePairs:number;unmatchedPairs:number;
  testCode:string;warnings:string[];tables:TableReview[];
  selectedTable:string;sourceTablesInUpload:number;excludedOtherSourceTables:number;
  configuredComponentCount:number;notRepresentedBySourceRangePairs:string[];
  ambiguousConfiguredCodes:string[];sourceEvidenceWarnings:number;
  clinicalMappingConfirmed:false;sourceSnapshotVerified:false;layoutApplied:false;
  referenceIntervalsImported:false;
};
const MAX_BYTES=6*1024*1024;
// Source table names recovered from the legacy Access reference analysis,
// not guesses mapping these tables to configured tests.
const LEGACY_TABLES=["cbcn","coagn","fertn","Glycosen","kidnyn","lipidn","livern",
  "Thyroidn","TORCHn","Tumern"] as const;
export function LegacySpecialtyEvidenceReview({testId,locale}:{testId:string;locale:"ar"|"en"}){
  const input=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false);
  const [selectedTable,setSelectedTable]=useState("");
  const [error,setError]=useState("");
  const [review,setReview]=useState<Review|null>(null);
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  async function load(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    if(!file)return;
    if(!selectedTable){setError(tr("Select the source table first.","اختر جدول المصدر أولاً."));return;}
    setReview(null);setError("");
    if(!file.name.toLowerCase().endsWith(".json")||file.size===0||file.size>MAX_BYTES){
      setError(tr("Choose a JSON evidence export up to 6 MB.","اختر ملف أدلة JSON بحجم لا يزيد عن 6 ميغابايت."));
      return;
    }
    setBusy(true);
    try{
      const evidence:unknown=JSON.parse(await file.text());
      const response=await fetch("/api/catalog/legacy-specialty-evidence",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({testId,evidence,selectedTable}),cache:"no-store",
      });
      const result=await response.json() as Review & {error?:string};
      if(!response.ok||result.status!=="review_only")
        throw Error(result.error||"legacy_specialty_review_failed");
      setReview(result);
    }catch(e){setError(tr("Review failed: ","فشلت المراجعة: ")+(e instanceof Error?e.message:"invalid_json"));}
    finally{setBusy(false);if(input.current)input.current.value="";}
  }
  return <article className="detail-card detail-section" dir={locale==="ar"?"rtl":"ltr"}>
    <h3>{tr("Legacy Specialty Reference Evidence (Review Only)","مراجعة أدلة المديات المتخصصة القديمة (للمراجعة فقط)")}</h3>
    <p className="muted">{tr(
      "Use the Windows PowerShell extractor in scripts/legacy/export-specialty-reference-evidence.ps1 with your cleaned MDB. It reads only paired low/high range columns plus age/sex selectors from known specialty reference tables. It never exports patient/order/result tables. Upload the JSON here to compare source column prefixes with the current configured test components.",
      "شغّل أداة PowerShell الموجودة في scripts/legacy/export-specialty-reference-evidence.ps1 على نسخة Access النظيفة في ويندوز. تستخرج فقط أعمدة الحدين الأعلى والأدنى المتطابقة ومحددات الجنس والعمر من جداول المديات المتخصصة المعروفة، دون جداول المرضى أو الطلبات أو النتائج. ارفع ملف JSON هنا لمقارنة رموز الأعمدة بمكونات الفحص الحالية."
    )}</p>
    <p className="muted">{tr(
      "The local extractor requires Microsoft Access Database Engine (ACE). The review performs no import and never approves or saves clinical reference values.",
      "تحتاج أداة الاستخراج المحلية إلى Microsoft Access Database Engine (ACE). المعاينة لا تستورد ولا تعتمد أو تحفظ أي قيمة مرجعية طبية."
    )}</p>
    <label>{tr("Which Access specialty reference table are you reviewing for this test?",
      "أي جدول مديات تخصصية من Access تريد مراجعته مع هذا الفحص؟")}
      <select value={selectedTable} disabled={busy}
        onChange={event=>{setSelectedTable(event.target.value);setReview(null);setError("");}}>
        <option value="">{tr("Select one legacy table — no automatic mapping","اختر جدولاً قديماً — بدون ربط تلقائي")}</option>
        {LEGACY_TABLES.map(name=><option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    <p className="muted">{tr(
      "This explicit table choice only limits structural comparison. It is not a clinically approved relationship between this test and an Access table.",
      "اختيار الجدول يحدد نطاق المقارنة البنيوية فقط، ولا يعني اعتماد ربط طبي بين الفحص وجدول Access."
    )}</p>
    <label>{tr("Specialty evidence JSON","ملف أدلة التخصصات JSON")}
      <input ref={input} type="file" accept=".json,application/json" disabled={busy||!selectedTable}
        onChange={e=>void load(e)}/>
    </label>
    {busy&&<p role="status">{tr("Validating source evidence…","جارٍ التحقق من أدلة المصدر…")}</p>}
    {error&&<p role="alert" className="form-warning">{error}</p>}
    {review&&<div className="detail-section">
      <p role="status"><strong>{tr("Read-only review completed","اكتملت المراجعة دون حفظ بيانات")}</strong></p>
      <p>{tr("Source: ","المصدر: ")}<strong>{review.sourceName}</strong> · {tr("Current test: ","الفحص الحالي: ")}{review.testCode}</p>
      <p>{tr("Selected source table: ","جدول المصدر المختار: ")}<strong>{review.selectedTable}</strong> ·
        {tr("Other tables excluded from this test comparison: ","جداول أخرى مستبعدة من مقارنة هذا الفحص: ")}
        {review.excludedOtherSourceTables}</p>
      <p>{tr("Configured active components: ","المكونات النشطة المهيأة: ")}{review.configuredComponentCount} ·
        {tr("Paired source columns not matching an active component: ","أزواج أعمدة المصدر التي لم تطابق مكوناً نشطاً: ")}
        {review.unmatchedPairs}</p>
      {review.notRepresentedBySourceRangePairs.length>0&&<p className="muted">{tr(
        "Configured components not represented in the selected table's paired low/high columns (may be text or qualitative; not automatically missing): ",
        "مكونات مهيأة لا تقابلها أعمدة حد أدنى/أعلى في الجدول المختار (قد تكون نصية أو نوعية، ولا تعتبر تلقائياً مفقودة): "
      )}{review.notRepresentedBySourceRangePairs.join(", ")}</p>}
      {review.ambiguousConfiguredCodes.length>0&&<p className="form-warning">{tr(
        "Ambiguous duplicate component codes: ","رموز مكونات متكررة وملتبسة: "
      )}{review.ambiguousConfiguredCodes.join(", ")}</p>}
      <p>{tr("Tables reviewed: ","الجداول التي خضعت للمراجعة: ")}{review.tableCount} · {tr("Candidate range pairs: ","أزواج المديات المرشحة: ")}
        {review.totalCandidatePairs} · {tr("Unmatched or ambiguous: ","غير المتطابقة أو الملتبسة: ")}{review.unmatchedPairs}</p>
      <p className="muted">{tr("Exporter-reported source SHA256: ","بصمة SHA256 كما وردت من أداة التصدير: ")}
        <code>{review.sourceSha256}</code></p>
      {review.warnings.map((warning,index)=><p key={index} className="form-warning">{warning}</p>)}
      {review.tables.map(table=><section key={table.tableName} className="table-card">
        <div className="table-toolbar">
          <h4>{table.tableName}</h4><span>{table.pairs.length} {tr("candidate pair(s)","زوج مرشّح")}</span>
        </div>
        {table.warnings.map((message,index)=><p key={index} className="muted">{message}</p>)}
        <div className="table-wrap"><table>
          <thead><tr>
            <th>{tr("Legacy field prefix","بادئة العمود القديمة")}</th>
            <th>{tr("Low / High columns","أعمدة الحد الأدنى / الأعلى")}</th>
            <th>{tr("Rows","الصفوف")}</th>
            <th>{tr("Missing bounds","حدود ناقصة")}</th>
            <th>{tr("Inverted bounds","حدود مقلوبة")}</th>
            <th>{tr("Unrecognized selectors","محددات غير معروفة")}</th>
            <th>{tr("Existing component match","المكوّن المطابق في الدليل")}</th>
          </tr></thead>
          <tbody>{table.pairs.length===0?<tr><td colSpan={7}>
            {tr("No reliable low/high pairs found; manual schema review required.",
              "لا توجد أعمدة حدّين متطابقة بشكل موثوق؛ تلزم مراجعة بنية الجدول يدوياً.")}</td></tr>:
            table.pairs.map(p=><tr key={p.prefix}>
              <td>{p.prefix}</td><td>{p.lowColumn} / {p.highColumn}</td>
              <td>{p.observationCount}</td><td>{p.incompleteBounds}</td>
              <td>{p.invertedBounds}</td><td>{p.unknownSelectors}</td>
              <td>{p.matchStatus==="EXACT_COMPONENT_CODE"?
                tr("Exact code: ","رمز مطابق: ")+(p.matchedComponentCode||""):
                p.matchStatus==="AMBIGUOUS_CODE"?
                  tr("Ambiguous — review manually","ملتبس — يحتاج مراجعة"):
                  tr("Unmatched — map manually","غير مطابق — يحتاج ربطاً يدوياً")}</td>
            </tr>)}</tbody>
        </table></div>
      </section>)}
      <p className="form-warning">{tr(
        "Clinical sign-off is mandatory: review unit, method, age units, sex, reference interval limits, and specimen applicability separately in the governed reference-interval workflow. No interval was imported.",
        "الاعتماد الطبي إلزامي: راجع الوحدة والطريقة ووحدة العمر والجنس وحدود المدى ونوع العينة بشكل مستقل عبر مسار اعتماد المديات المرجعية. لم يتم استيراد أي مدى."
      )}</p>
    </div>}
  </article>;
}
