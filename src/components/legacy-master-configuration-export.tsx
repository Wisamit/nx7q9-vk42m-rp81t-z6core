"use client";
import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";

type Kind="REFERRER"|"SOURCE"|"ORGANISM"|"ANTIBIOTIC"|"CLIENT"|"COMMENT_TEMPLATE";
type CsvPart={partNumber:number;rowCount:number;firstCode:string;lastCode:string;
  sha256:string;csv:string;sourceRecords:Array<{id:string;code:string;status:string}>};
type MasterManifest={format:string;schemaVersion:number;organizationId:string;
  kind:Kind;exportedAt:string;consistency:string;scope:string;totalRows:number;
  partCount:number;integritySha256:string;parts:CsvPart[];warnings:string[]};
const labels:Record<Kind,[string,string]>={
  REFERRER:["Referrers / doctors","الجهات المحيلة والأطباء"],
  SOURCE:["Order sources","مصادر الطلبات"],
  ORGANISM:["Organisms","الكائنات الدقيقة"],
  ANTIBIOTIC:["Antibiotics","المضادات الحيوية"],
  CLIENT:["Corporate clients / accounts","العملاء والجهات المتعاقدة"],
  COMMENT_TEMPLATE:["Clinical comment templates","قوالب التعليقات السريرية"],
};
function download(content:string,name:string,type:string){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement("a");
  link.href=url;link.download=name;document.body.appendChild(link);link.click();
  link.remove();URL.revokeObjectURL(url);
}
export function LegacyMasterConfigurationExport({locale,kinds}:{
  locale:"ar"|"en";kinds:Kind[];
}){
  const tr=(en:string,ar:string)=>locale==="ar"?ar:en;
  const [kind,setKind]=useState<Kind>(kinds[0]||"SOURCE");
  const [busy,setBusy]=useState(false);
  const [confirmOpen,setConfirmOpen]=useState(false);
  const [notice,setNotice]=useState("");
  const [archive,setArchive]=useState<MasterManifest|null>(null);
  async function exportMaster(){
    if(busy)return;
    setBusy(true);setNotice("");setArchive(null);
    try{
      const r=await fetch("/api/legacy/master-data-export?kind="+encodeURIComponent(kind),{
        method:"GET",credentials:"same-origin",cache:"no-store",
      });
      const data=await r.json().catch(()=>({})) as Partial<MasterManifest>&{error?:string};
      if(!r.ok||data.format!=="family-lab-legacy-master-configuration-export"){
        setNotice(tr("Export rejected: ","تعذر التصدير: ")+(data.error||"unknown"));
        return;
      }
      const manifest=data as MasterManifest;
      setArchive(manifest);
      setConfirmOpen(false);
      setNotice(tr("Export ready. Download the JSON evidence and selected CSV parts separately.",
        "التصدير جاهز. نزّل ملف إثبات JSON وأجزاء CSV المطلوبة بشكل منفصل."));
    }catch{
      setNotice(tr("Connection failed; no export was retrieved.","انقطع الاتصال؛ لم يصل ملف التصدير."));
    }finally{setBusy(false);}
  }
  return <section className="detail-card" dir={locale==="ar"?"rtl":"ltr"}>
    <h2>{tr("Controlled Master Configuration Export","تصدير البيانات المرجعية المضبوط")}</h2>
    <p className="muted">{tr(
      "One tenant, one record class and one consistent database snapshot per export. Only active masters. CSV parts (up to 200 rows each) use the exact existing import headers. This is NOT a database backup.",
      "التصدير يشمل مؤسسة واحدة ونوع بيانات واحدًا بقراءة متسقة. السجلات النشطة فقط، وكل جزء CSV يحوي حتى 200 صف بترويسة المستورد الحالي. هذا ليس نسخة احتياطية من قاعدة البيانات."
    )}</p>
    <div className="form-grid">
      <label>{tr("Master category","نوع البيانات")}
        <select value={kind} disabled={busy} onChange={e=>{
          setKind(e.target.value as Kind);setArchive(null);setNotice("");
        }}>{kinds.map(k=><option value={k} key={k}>{tr(labels[k][0],labels[k][1])}</option>)}</select>
      </label>
      <button type="button" className="primary-button" disabled={busy||kinds.length===0}
        onClick={()=>{setNotice("");setConfirmOpen(true);}}>{busy?tr("Preparing…","جارٍ التجهيز…"):
        tr("Prepare controlled export","تجهيز تصدير مضبوط")}</button>
    </div>
    <CrudModal open={confirmOpen} onClose={()=>{if(!busy)setConfirmOpen(false);}}
      size="compact"
      title={tr("Confirm Controlled Master Export","تأكيد تصدير البيانات المرجعية المضبوط")}
      description={tr(
        "Exporting referrers and clients can disclose contact information. Only approved staff may export and must store/download data securely.",
        "قد يكشف تصدير العملاء والأطباء معلومات التواصل. التصدير للمخولين فقط مع الالتزام بحفظ الملفات بأمان.",
      )}>
      {confirmOpen&&<div className="catalog-form">
        <p className="form-span"><strong>{tr(labels[kind][0],labels[kind][1])}</strong></p>
        <p className="form-warning form-span">{tr(
          "This is an export of approved active master configuration, not a database backup. The downloaded files may contain personal and business contact details.",
          "هذا تصدير للبيانات المرجعية النشطة المسموح بها وليس نسخة احتياطية. قد تحتوي الملفات على معلومات تواصل شخصية وتجارية.",
        )}</p>
        <button type="button" className="primary-button form-span" disabled={busy||kinds.length===0}
          onClick={()=>void exportMaster()}>
          {busy?tr("Preparing…","جارٍ التجهيز…"):
            tr("Confirm authorized export","تأكيد التصدير المصرّح")}
        </button>
        {notice&&<p className="form-error form-span" role="alert">{notice}</p>}
      </div>}
    </CrudModal>
    {notice&&<p role="status" className="form-warning">{notice}</p>}
    {archive&&<div className="detail-section">
      <p><strong>{tr("Organization","المؤسسة")}:</strong> {archive.organizationId}</p>
      <p><strong>{tr("Active rows","السجلات النشطة")}:</strong> {archive.totalRows} ·
        <strong> {tr("CSV parts","أجزاء CSV")}:</strong> {archive.partCount}</p>
      <p style={{overflowWrap:"anywhere"}}><strong>{tr("SHA-256 checksum","بصمة SHA-256")}:</strong> <code>{archive.integritySha256}</code></p>
      <button type="button" className="secondary-button" onClick={()=>
        download(JSON.stringify(archive,null,2),
          "family-lab-master-"+archive.kind.toLowerCase()+".json","application/json;charset=utf-8")}>
        {tr("Download full JSON evidence and CSV manifest","تحميل الأرشيف الكامل JSON وإثباتاته")}</button>
      {archive.parts.length>0&&<div className="table-wrap"><table>
        <thead><tr><th>{tr("Part","الجزء")}</th><th>{tr("Rows","الصفوف")}</th>
          <th>{tr("Codes","الأكواد")}</th><th>{tr("Download","تحميل")}</th></tr></thead>
        <tbody>{archive.parts.map(part=><tr key={part.partNumber}>
          <td>{part.partNumber}</td><td>{part.rowCount}</td>
          <td>{part.firstCode} – {part.lastCode}</td>
          <td><button type="button" className="secondary-button" onClick={()=>
            download(part.csv,"family-lab-"+archive.kind.toLowerCase()+
              "-part-"+part.partNumber+".csv","text/csv;charset=utf-8")}>
            {tr("Download CSV","تحميل CSV")}</button></td>
        </tr>)}</tbody>
      </table></div>}
      {archive.totalRows===0&&<p className="muted">{tr("No active source records in this category.",
        "لا توجد سجلات نشطة ضمن هذا النوع.")}</p>}
      <p className="form-warning">{tr(
        "Safeguards: importing into another LIS requires a separate preview and confirmation. Existing codes are not overwritten. Comment templates are always re-imported INACTIVE. Source contracts, balances, prices, clinical histories and linked accounts are NOT restored.",
        "ضوابط الأمان: استيراد الملف في نظام آخر يتطلب معاينة واعتمادًا منفصلين. الأكواد الموجودة لا تُستبدل، وقوالب التعليقات تُستورد غير مفعّلة. لا تُستعاد العقود أو الأرصدة أو الأسعار أو السجلات السريرية أو الروابط بين الحسابات."
      )}</p>
    </div>}
  </section>;
}
