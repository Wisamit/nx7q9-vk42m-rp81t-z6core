"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "REFERRER" | "SOURCE" | "ORGANISM" | "ANTIBIOTIC" | "CLIENT" | "COMMENT_TEMPLATE";
type PreviewRow = {
  rowNumber: number;
  code: string;
  nameEn: string;
  nameAr: string | null;
  status: "NEW" | "CONFLICT";
  clientType?: string | null;
  paymentTermsDays?: number | null;
  commentScope?: string | null;
  testCode?: string | null;
  componentCode?: string | null;
  textEn?: string | null;
  textAr?: string | null;
};
type Preview = {
  kind: Kind;
  fingerprint: string;
  total: number;
  eligible: number;
  conflicts: Array<{ rowNumber: number; code: string; reason: string }>;
  rows: PreviewRow[];
};

const headers: Record<Kind, string> = {
  REFERRER: "code,name_en,name_ar,type,phone,email,license_number",
  SOURCE: "code,name_en,name_ar,category",
  ORGANISM: "code,name_en,name_ar,category",
  ANTIBIOTIC: "code,name_en,name_ar,drug_class",
  CLIENT: "code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days",
  COMMENT_TEMPLATE: "code,name_en,name_ar,text_en,text_ar,scope,test_code,component_code",
};

export function LegacyMasterDataImport({
  locale,
  availableKinds,
}: {
  locale: "ar" | "en";
  availableKinds: Kind[];
}) {
  const router = useRouter();
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [kind, setKind] = useState<Kind>(availableKinds[0] ?? "REFERRER");
  const [csv, setCsv] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState<"PREVIEW" | "APPLY" | "">("");
  const [message, setMessage] = useState("");
  const [importId, setImportId] = useState("");

  async function send(mode: "PREVIEW" | "APPLY") {
    if (working) return;
    if (mode === "APPLY" && (!preview || preview.kind !== kind ||
      preview.conflicts.length > 0 || !confirmed)) return;
    setWorking(mode);
    setMessage("");
    try {
      const response = await fetch("/api/legacy/master-data-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, kind, csv, sourceName,
          ...(mode === "APPLY" ? {
            confirmation: kind === "CLIENT" ? "CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS" :
              kind === "COMMENT_TEMPLATE" ? "CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY" : "CREATE_NEW_RECORDS_ONLY",
            expectedFingerprint: preview?.fingerprint,
          } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as Preview & {
        error?: string; status?: string; importId?: string; count?: number;
      };
      if (!response.ok) {
        setMessage(data.error || tr("Import request failed.", "فشل طلب الاستيراد."));
        if (mode === "APPLY") { setPreview(null); setConfirmed(false); }
        return;
      }
      if (mode === "PREVIEW") {
        setPreview(data);
        setConfirmed(false);
        setImportId("");
        setMessage(tr(
          "Review all new and duplicate records. No data has been imported.",
          "راجع السجلات الجديدة والمكررة. لم يتم استيراد أي بيانات بعد.",
        ));
      } else {
        setImportId(data.importId || "");
        setPreview(null);
        setConfirmed(false);
        setCsv("");
        setMessage(tr(
          "Successfully created " + (data.count ?? 0) + " new master records with audit history.",
          "تم إنشاء " + (data.count ?? 0) + " سجل مرجعي جديد مع سجل تدقيق.",
        ));
        router.refresh();
      }
    } catch {
      setMessage(tr("Connection failed; check import status before retrying.", "فشل الاتصال؛ تحقق من حالة الاستيراد قبل إعادة المحاولة."));
      setPreview(null);
      setConfirmed(false);
    } finally {
      setWorking("");
    }
  }

  const label: Record<Kind, string> = {
    REFERRER: tr("Referrers", "الجهات المحيلة"),
    SOURCE: tr("Order sources", "مصادر الطلبات"),
    ORGANISM: tr("Organisms", "الجراثيم"),
    ANTIBIOTIC: tr("Antibiotics", "المضادات الحيوية"),
    CLIENT: tr("Corporate clients / accounts", "حسابات العملاء والجهات المتعاقدة"),
    COMMENT_TEMPLATE: tr("Clinical comment templates", "قوالب التعليقات السريرية"),
  };
  return <section className="detail-card">
    <h2>{tr("Controlled Legacy Master Data Import", "استيراد مضبوط للبيانات المرجعية القديمة")}</h2>
    <p className="muted">{tr(
      "Import normalized UTF-8 CSV exported or mapped from Access. Preview is read-only; approval creates NEW records only. Existing codes are never overwritten.",
      "استورد CSV بترميز UTF-8 بعد تحويل أعمدة Access للتنسيق المحدد. المعاينة للقراءة فقط؛ الاعتماد ينشئ السجلات الجديدة دون تعديل الأكواد الموجودة.",
    )}</p>
    <div className="catalog-form">
      <label>{tr("Data class", "نوع البيانات")}
        <select value={kind} disabled={Boolean(working)} onChange={e => {
          setKind(e.target.value as Kind); setPreview(null); setConfirmed(false); setMessage("");
        }}>
          {availableKinds.map(item => <option key={item} value={item}>{label[item]}</option>)}
        </select>
      </label>
      <label>{tr("Source file label (optional)", "اسم الملف المصدر (اختياري)")}
        <input value={sourceName} maxLength={160} disabled={Boolean(working)}
          onChange={e => { setSourceName(e.target.value); setPreview(null); setConfirmed(false); }}/>
      </label>
      <div>
        <strong>{tr("Required CSV header (exact order)", "ترويسة CSV المطلوبة (بنفس الترتيب)")}</strong>
        <p><code>{headers[kind]}</code></p>
        {kind === "REFERRER" && <small>{tr(
          "Referrer type must be PHYSICIAN, CLINIC, HOSPITAL or OTHER.",
          "نوع المحيل يجب أن يكون PHYSICIAN أو CLINIC أو HOSPITAL أو OTHER.",
        )}</small>}
        {kind === "COMMENT_TEMPLATE" && <p className="form-warning">{tr(
          "Clinical comments: supply ORGANIZATION / TEST / COMPONENT scope and active test_code / component_code as required. All imported templates stay INACTIVE until reviewed separately. No existing result or report changes.",
          "التعليقات السريرية: حدد النطاق ORGANIZATION أو TEST أو COMPONENT، مع رموز الفحوصات والمكوّنات الفعالة المطلوبة. تبقى جميع القوالب المستوردة غير مفعّلة حتى المراجعة المنفصلة، دون تعديل النتائج أو التقارير."
        )}</p>}
        {kind === "CLIENT" && <p className="form-warning">{tr(
          "Clients: explicit type INDIVIDUAL / CLINIC / HOSPITAL / COMPANY / INSURANCE / OTHER; payment_terms_days blank or 0–3650. Import creates client masters only, NOT contracts, client prices, financial balances, credit approvals, or referrer relationships.",
          "العملاء: النوع يجب أن يكون INDIVIDUAL أو CLINIC أو HOSPITAL أو COMPANY أو INSURANCE أو OTHER؛ أيام الدفع فارغة أو من 0 إلى 3650. الاستيراد ينشئ بيانات العملاء فقط، ولا ينشئ عقودًا أو أسعارًا أو أرصدة أو موافقات ائتمانية أو ربطًا تلقائيًا بجهات الإحالة."
        )}</p>}
      </div>
      <label>{tr("CSV content (up to 200 data rows, 64 KiB)", "محتوى CSV (حتى 200 صف، 64 كيلوبايت)")}
        <textarea rows={9} value={csv} disabled={Boolean(working)}
          placeholder={headers[kind]} onChange={e => {
            setCsv(e.target.value); setPreview(null); setConfirmed(false); setImportId(""); setMessage("");
          }}/>
      </label>
      <button type="button" className="secondary-button" disabled={Boolean(working) || !csv.trim()}
        onClick={() => send("PREVIEW")}>
        {working === "PREVIEW" ? tr("Reviewing…", "جارٍ الفحص…") : tr("1. Preview and check duplicates", "1. معاينة وفحص التكرار")}
      </button>
    </div>
    {message && <p role="status" className="muted">{message}</p>}
    {importId && <p className="muted">{tr("Audit import ID", "معرّف عملية الاستيراد")}: <code>{importId}</code></p>}
    {preview && <div className="detail-section">
      <h3>{tr("Preview — nothing has been saved", "المعاينة — لم يتم حفظ أي شيء")}</h3>
      <p>{tr("Rows", "الصفوف")}: {preview.total} · {tr("New", "جديدة")}: {preview.eligible} · {tr("Conflicts", "متعارضة")}: {preview.conflicts.length}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>#</th><th>{tr("Code", "الرمز")}</th><th>{tr("English", "الإنكليزية")}</th><th>{tr("Arabic", "العربية")}</th>{kind === "CLIENT" && <><th>{tr("Client type", "نوع العميل")}</th><th>{tr("Payment terms (days)", "أيام الدفع")}</th></>}{kind === "COMMENT_TEMPLATE" && <><th>{tr("Scope / target", "النطاق / الهدف")}</th><th>{tr("English / Arabic comment", "التعليق الإنكليزي / العربي")}</th></>}<th>{tr("Status", "الحالة")}</th></tr></thead>
        <tbody>{preview.rows.map(row => <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td><td>{row.code}</td><td>{row.nameEn}</td><td>{row.nameAr || "—"}</td>{kind === "CLIENT" && <><td>{row.clientType || "—"}</td><td>{row.paymentTermsDays ?? tr("Not set", "غير محددة")}</td></>}{kind === "COMMENT_TEMPLATE" && <><td>{[row.commentScope, row.testCode, row.componentCode].filter(Boolean).join(" / ")}</td><td><span>{row.textEn}</span>{row.textAr && <><hr/><span dir="rtl">{row.textAr}</span></>}</td></>}
          <td>{row.status === "NEW" ? tr("New", "جديد") : tr("Existing code — blocked", "رمز موجود — ممنوع")}</td>
        </tr>)}</tbody>
      </table></div>
      {preview.conflicts.length ? <p className="form-warning" role="alert">{tr(
        "Import is blocked. Resolve the listed existing codes and preview again. No rows can be overwritten or skipped silently.",
        "الاستيراد محظور حتى معالجة الأكواد الموجودة وإعادة المعاينة. لا يتم تعديل أو تجاوز أي صف تلقائيًا.",
      )}</p> : <>
        <label className="checkbox-label">
          <input type="checkbox" checked={confirmed} disabled={Boolean(working)}
            onChange={e => setConfirmed(e.target.checked)}/>
          {tr(
            kind === "CLIENT"
              ? "I explicitly approve ONLY new client master records and displayed payment terms. No contracts, prices, balances or automatic referrer linking will be imported."
              : kind === "COMMENT_TEMPLATE"
              ? "I approve ONLY inactive clinical comment templates. These texts cannot appear in results or reports until separately reviewed and activated."
              : "I approve creating these NEW master records only. All records will be audited.",
            kind === "CLIENT"
              ? "أوافق صراحةً على إنشاء العملاء الجدد وشروط الدفع المعروضة فقط. لن تُستورد عقود أو أسعار أو أرصدة ولن يُربط المحيلون تلقائيًا."
              : kind === "COMMENT_TEMPLATE"
              ? "أوافق على استيراد قوالب التعليقات السريرية وهي غير مفعّلة، ولا تُستخدم حتى المراجعة والتفعيل بشكل منفصل."
              : "أوافق على إنشاء هذه السجلات المرجعية الجديدة فقط، مع تسجيل عملية تدقيق لكل سجل.",
          )}
        </label>
        <button type="button" className="primary-button"
          disabled={Boolean(working) || !confirmed} onClick={() => send("APPLY")}>
          {working === "APPLY" ? tr("Importing…", "جارٍ الاستيراد…") : tr("2. Approve and create records", "2. اعتماد وإنشاء السجلات")}
        </button>
      </>}
    </div>}
  </section>;
}
