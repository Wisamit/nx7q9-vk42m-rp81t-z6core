"use client";

import { useRef, useState } from "react";

type Finding = {
  tableName:string;target:string;mode:string;present:boolean;
  sourceRows:number;stagedCandidates:number|null;
  stagedImported:number|null;stagedUnresolved:number|null;stagedSkipped:number|null;
  finding:string;verified:false;clinicalApproved:false;financialApproved:false;
};
type Review = {
  status:"REVIEW_ONLY";sourceSha256:string;manifestFingerprint:string;
  sourceName:string;possibleBatches:number;sourceIndependentlyVerified:false;
  rowParityCertified:false;clinicalApproved:false;financialApproved:false;
  cutoverApproved:false;coverage:Finding[];findings:string[];error?:string;
};
const MAX_BYTES = 64 * 1024;
export function LegacySourceCoverageReview({locale}:{locale:"ar"|"en"}) {
  const tr = (en:string,ar:string) => locale==="ar"?ar:en;
  const input = useRef<HTMLInputElement>(null);
  const [result,setResult] = useState<Review|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const messages: Record<string,[string,string]> = {
    SOURCE_TABLE_NOT_FOUND:["Table not found in this Access source","الجدول غير موجود في مصدر Access"],
    SOURCE_TABLE_EMPTY:["Source table contains no records","الجدول الأصلي فارغ"],
    DIRECT_IMPORT_REQUIRES_PROVENANCE:[
      "Direct CSV master import needs independent source-to-record proof",
      "استيراد البيانات المرجعية المباشر يحتاج إثبات مصدر مستقل لكل سجل",
    ],
    MANUAL_MAPPING_REQUIRED:["Manual alias / group mapping required","تتطلب مطابقة الأسماء المستعارة أو المجموعات يدوياً"],
    NO_LINKED_STAGING_BATCHES:["No same-name staging batch authored by this operator","لا توجد دفعات تجهيز بنفس اسم الملف أنشأها هذا المستخدم"],
    SOURCE_COUNT_EXCEEDS_STAGING_CANDIDATES:[
      "More source rows than staging candidates (not an identity proof)",
      "صفوف المصدر أكثر من مرشحات التجهيز (ليست دليلاً على تطابق الهوية)",
    ],
    STAGING_CANDIDATES_EXCEED_SOURCE_COUNT:[
      "More staging candidates than source rows; investigate duplicates",
      "مرشحات التجهيز أكثر من صفوف المصدر؛ راجع التكرارات",
    ],
    COUNT_MATCH_NOT_ROW_PROOF:[
      "Counts match but individual rows and approvals are NOT verified",
      "العدد متطابق، لكن هوية كل صف واعتماده غير مثبتين",
    ],
  };
  async function review(file:File) {
    if(loading)return;
    setError("");setResult(null);
    if(!file.name.toLowerCase().endsWith(".json")||file.size===0||file.size>MAX_BYTES) {
      setError(tr("Choose a source coverage JSON (max 64 KB).","اختر ملف مطابقة المصدر JSON بحد أقصى 64 كيلوبايت."));
      return;
    }
    setLoading(true);
    try {
      const response=await fetch("/api/catalog/legacy-source-coverage",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:file,cache:"no-store",
      });
      const parsed=await response.json() as Review;
      if(!response.ok||parsed.status!=="REVIEW_ONLY"||parsed.rowParityCertified!==false)
        throw Error(parsed.error||"source_coverage_review_failed");
      setResult(parsed);
    } catch(e) {
      setError(tr("Unable to review Access evidence: ","تعذرت مراجعة مصدر Access: ")+
        (e instanceof Error?e.message:"source_coverage_review_failed"));
    } finally {
      setLoading(false);
      if(input.current)input.current.value="";
    }
  }
  return <section className="detail-section" dir={locale==="ar"?"rtl":"ltr"}>
    <h2>{tr("Legacy MDB Source Coverage — Review Only","تغطية بيانات Access القديمة — للمراجعة فقط")}</h2>
    <p className="muted">{tr(
      "Generate the 15-table metadata manifest locally with scripts/legacy/export-source-coverage.ps1 using Access ACE. It includes only presence, counts, schema hashes and the MDB fingerprint. Never upload the Access database, patient files or raw reference ranges.",
      "أنشئ ملف البيانات الوصفية للجداول الخمسة عشر محلياً باستخدام scripts/legacy/export-source-coverage.ps1 وموفّر Access ACE. يحتوي على وجود الجداول والأعداد وبصمات بنيتها وبصمة قاعدة البيانات فقط. لا ترفع ملف Access أو بيانات المرضى أو القيم المرجعية الخام.",
    )}</p>
    <p className="muted">{tr(
      "Comparison is limited to same-filename staging batches created by your account; other operators' and direct CSV master imports cannot be certified by these counts. Matching counts never certify clinical or financial migration.",
      "المقارنة تقتصر على دفعات التجهيز المطابقة لاسم الملف والمنشأة بحسابك، ولا تثبت استيرادات المستخدمين الآخرين أو البيانات المرجعية المباشرة. تطابق الأعداد لا يعني اعتماد الترحيل السريري أو المالي.",
    )}</p>
    <input ref={input} type="file" hidden accept=".json,application/json"
      onChange={event=>{const file=event.target.files?.[0];if(file)void review(file);}}/>
    <button className="secondary-button" type="button" disabled={loading}
      onClick={()=>input.current?.click()}>
      {loading?tr("Reviewing source coverage…","جارٍ فحص تغطية المصدر…"):
        tr("Review source coverage JSON","مراجعة ملف تغطية المصدر")}
    </button>
    {error&&<p role="alert">{error}</p>}
    {result&&<div className="detail-section">
      <h3>{tr("Source review evidence","أدلة مراجعة المصدر")}</h3>
      <p>{tr("Source name","اسم المصدر")}: {result.sourceName}</p>
      <p>{tr("Possible same-name batches","دفعات محتملة بنفس الاسم")}: {result.possibleBatches}</p>
      <p className="muted">{tr("MDB SHA-256","بصمة قاعدة Access")}: <code>{result.sourceSha256}</code></p>
      <p className="muted">{tr("Manifest fingerprint","بصمة ملف الأدلة")}: <code>{result.manifestFingerprint}</code></p>
      <p role="status"><strong>{tr(
        "NOT CERTIFIED — no row-level provenance, clinical/financial sign-off or cutover approval.",
        "غير معتمد — لا يوجد إثبات مطابقة لكل صف أو موافقة سريرية/مالية أو تصريح بالانتقال للنظام الجديد.",
      )}</strong></p>
      <div style={{overflowX:"auto"}}>
        <table className="data-table">
          <thead><tr>
            <th>{tr("Access table","جدول Access")}</th>
            <th>{tr("Target","الهدف")}</th>
            <th>{tr("Source rows","صفوف المصدر")}</th>
            <th>{tr("Staged candidates","مرشحات التجهيز")}</th>
            <th>{tr("Imported / unresolved","المستوردة / غير المحسومة")}</th>
            <th>{tr("Finding","الملاحظة")}</th>
          </tr></thead>
          <tbody>{result.coverage.map(item=><tr key={item.tableName}>
            <td>{item.tableName}</td><td>{item.target}</td>
            <td>{item.present?item.sourceRows:"—"}</td>
            <td>{item.stagedCandidates??"—"}</td>
            <td>{item.stagedImported===null?"—":item.stagedImported+" / "+item.stagedUnresolved}</td>
            <td>{tr(...(messages[item.finding]||[item.finding,item.finding]))}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
  </section>;
}
