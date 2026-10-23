"use client";

import { useState } from "react";
import { catalogReviewCsv } from "@/lib/catalog-review-csv";
import { catalogReviewXlsx } from "@/lib/catalog-review-xlsx";
import {
  canonicalStagingCsvFromAtomicGroup, supportsCanonicalSpreadsheetReview,
} from "@/lib/catalog-canonical-review-spreadsheet";
import { type CatalogExportType } from "@/lib/catalog-configuration-export";
import { checkedAtomicCatalogReviewSource } from "@/lib/catalog-atomic-review-source";

const ordered: CatalogExportType[] = [
  "TEST", "COMPONENT", "UNIT", "CONTAINER", "PANEL", "PACKAGE",
  "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM",
];

export function CatalogConfigurationExport({
  locale, canExportPricing, canExportRanges,
}: { locale: "ar" | "en"; canExportPricing: boolean; canExportRanges: boolean }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [selected, setSelected] = useState<CatalogExportType[]>([
    "TEST", "COMPONENT", "UNIT", "CONTAINER", "PANEL", "PACKAGE",
    ...(canExportRanges ? ["REFERENCE_INTERVAL" as const] : []),
    ...(canExportPricing ? ["PRICE_LIST" as const, "PRICE_LIST_ITEM" as const, "PRICE_LIST_PACKAGE_ITEM" as const] : []),
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = (t: CatalogExportType) => ({
    TEST: tr("Tests", "الفحوصات"),
    COMPONENT: tr("Result components", "مكوّنات النتائج"),
    UNIT: tr("Units (UCUM)", "الوحدات"),
    CONTAINER: tr("Specimen containers and tube properties", "حاويات العينات وخصائص الأنابيب"),
    PANEL: tr("Test panels and full membership", "مجموعات الفحوصات وكامل عضويتها"),
    PACKAGE: tr("Commercial packages and their tests", "الباقات التجارية والفحوصات التابعة لها"),
    REFERENCE_INTERVAL: tr("Reference intervals and critical limits", "المجالات المرجعية والحدود الحرجة"),
    PRICE_LIST: tr("Price lists and scopes", "قوائم الأسعار ونطاقاتها"),
    PRICE_LIST_ITEM: tr("Prices and effective dates", "الأسعار وتواريخ السريان"),
    PRICE_LIST_PACKAGE_ITEM: tr("Package prices and effective dates", "أسعار الباقات وتواريخ السريان"),
  }[t]);

  async function downloadStaging(format: "csv" | "xlsx") {
    if (busy || selected.length !== 1 || !supportsCanonicalSpreadsheetReview(selected[0])) return;
    setBusy(true); setMessage("");
    try {
      // The tenant-scoped, signed transactional source is fetched afresh.
      // Paged review exports are never used as the basis of this projection.
      const entityType = selected[0];
      const response = await fetch("/api/catalog/configuration-export/bundle?types=" +
        encodeURIComponent(entityType), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const problem = await response.json() as { error?: string };
        throw new Error(problem.error || "atomic_export_failed_" + response.status);
      }
      const source = await response.json() as {
        format?: string; schemaVersion?: number; organizationId?: string;
        exportedAt?: string; consistency?: string;
        groups?: Array<{entityType: CatalogExportType; records: unknown[]}>;
      };
      if (source.format !== "family-lab-catalog-bundle" || source.schemaVersion !== 1 ||
          source.consistency !== "transactional-consistent-read" ||
          !source.organizationId || !source.exportedAt ||
          !Array.isArray(source.groups) || source.groups.length !== 1 || source.groups[0].entityType !== entityType ||
          !Array.isArray(source.groups[0].records)) throw new Error("atomic_source_invalid");
      checkedAtomicCatalogReviewSource(source, [entityType]);
      const csv = canonicalStagingCsvFromAtomicGroup(source.groups[0]);
      const data = format === "xlsx" ? catalogReviewXlsx(csv) : csv;
      if ((typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength)
          > 2 * 1024 * 1024) throw new Error("canonical_review_upload_size_limit");
      const part: BlobPart = typeof data === "string" ? data :
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([part], {
        type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv;charset=utf-8",
      }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "family-lab-" + entityType.toLowerCase() +
          "-draft-review-" + source.exportedAt.slice(0,10) + "." + format;
        document.body.appendChild(link); link.click(); link.remove();
      } finally { URL.revokeObjectURL(url); }
      setMessage(tr(
        "Created " + source.groups[0].records.length +
        " canonical DRAFT review rows from one consistent snapshot. Re-upload via CSV/XLSX staging: never live, never an exact restore. Full source fields remain in the separately downloaded signed JSON.",
        "تم إعداد " + source.groups[0].records.length +
        " صف مراجعة DRAFT من لقطة بيانات متسقة. يمكن رفعها في مرحلة CSV/XLSX للمراجعة فقط، لا للتفعيل أو الاستعادة المطابقة. تبقى التفاصيل الكاملة في ملف JSON الموقّع المنفصل.",
      ));
    } catch (error) {
      setMessage(tr("Review-ready export refused; no partial file saved: ",
        "تم رفض التصدير المتوافق مع المراجعة ولم يُحفظ ملف جزئي: ") +
        (error instanceof Error ? error.message : "unknown_error"));
    } finally { setBusy(false); }
  }

  async function download(format: "json" | "csv" | "xlsx") {
    if (busy || selected.length === 0 || (format !== "json" && selected.length !== 1)) return;
    setBusy(true);
    setMessage("");
    try {
      if (format === "json") {
        const types = ordered.filter(t => selected.includes(t));
        const response = await fetch("/api/catalog/configuration-export/bundle?types=" +
          encodeURIComponent(types.join(",")), { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) {
          const failure = await response.json() as { error?: string };
          throw new Error(failure.error || "export_request_failed_" + response.status);
        }
        const text = await response.text();
        const bundle = checkedAtomicCatalogReviewSource(JSON.parse(text), types);
        const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
        try {
          const link = document.createElement("a");
          link.href = url;
          link.download = "family-lab-catalog-" + new Date().toISOString().slice(0, 10) + ".json";
          document.body.appendChild(link);
          link.click();
          link.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
        const total = bundle.groups.reduce((sum, group) => sum + group.records.length, 0);
        setMessage(tr("Exported " + total +
          " records from one consistent database read. This is a scoped configuration source, not a full backup or an approved import.",
          "تم تصدير " + total +
          " سجل من قراءة واحدة متّسقة لقاعدة البيانات. هذا مصدر إعدادات محدود الصلاحيات، وليس نسخة احتياطية كاملة أو استيراداً معتمداً."));
        return;
      }
      const entityType = selected[0];
      // Human-review CSV/XLSX must not silently combine different database
      // revisions from independently paged reads. Reuse the exact server-side
      // signed, tenant-scoped, transaction-consistent bundle read used by JSON.
      const response = await fetch("/api/catalog/configuration-export/bundle?types=" +
        encodeURIComponent(entityType), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        const problem = await response.json() as { error?: string };
        throw new Error(problem.error || "atomic_export_failed_" + response.status);
      }
      const source = checkedAtomicCatalogReviewSource(await response.json(), [entityType]);
      const group = source.groups[0];
      const exportedAt = source.exportedAt;
      const csvText = catalogReviewCsv(group, source.organizationId, exportedAt,
        "transactional-consistent-read");
      const fileContents = format === "xlsx" ? catalogReviewXlsx(csvText) : csvText;
      const part: BlobPart = typeof fileContents === "string" ? fileContents :
        fileContents.buffer.slice(fileContents.byteOffset, fileContents.byteOffset + fileContents.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([part], {
        type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8",
      }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "family-lab-catalog-" + (entityType.toLowerCase() + "-")
          + exportedAt.slice(0, 10) + "." + format;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      const total = group.records.length;
      setMessage(format === "xlsx"
        ? tr("Exported " + total + " Excel review rows from a single consistent database snapshot. All cells are literal text. This is NOT a backup, import or clinical approval.",
          "تم تصدير " + total + " صف Excel للمراجعة من لقطة واحدة متسقة لقاعدة البيانات. الخلايا نصية فقط؛ وليس الملف نسخة احتياطية أو استيراداً أو اعتماداً سريرياً.")
        : tr("Exported " + total + " review rows from one consistent database snapshot. This human-review CSV is NOT a lossless restore or an activatable import. Use the separately signed JSON for complete structured evidence.",
          "تم تصدير " + total + " صف مراجعة من لقطة واحدة متسقة لقاعدة البيانات. ملف CSV ليس استعادة مطابقة أو استيراداً قابلاً للتفعيل. استخدم JSON الموقّع المنفصل للأدلة الكاملة.")
        );
    } catch (error) {
      setMessage(tr("Export stopped; no partial file was saved: ", "توقف التصدير ولم يُحفظ ملف جزئي: ")
        + (error instanceof Error ? error.message : "unknown_error"));
    } finally {
      setBusy(false);
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Controlled catalog configuration export", "تصدير إعدادات الكتالوج بضوابط")}</h2>
    <p className="muted">{tr(
      "Read-only bilingual export with original identifiers, decimal strings, status, approval and effective dates. Price exports require separate pricing permission. Exported data is NOT imported automatically.",
      "تصدير للقراءة فقط مع المعرفات والقيم العشرية الأصلية وحالات الاعتماد وتواريخ السريان. تتطلب الأسعار صلاحية مستقلة. البيانات المصدرة لا تُستورد تلقائياً.",
    )}</p>
    <div className="form-grid">
      {ordered.filter(t => (canExportPricing || !t.startsWith("PRICE")) &&
        (canExportRanges || t !== "REFERENCE_INTERVAL")).map(entity => (
        <label key={entity} className="check-line">
          <input type="checkbox" checked={selected.includes(entity)} disabled={busy}
            onChange={event => setSelected(current => event.target.checked
              ? [...current, entity]
              : current.filter(x => x !== entity))} />
          {label(entity)}
        </label>
      ))}
    </div>
    <div className="review-actions">
      <button type="button" className="primary-button" disabled={busy || selected.length === 0}
        onClick={() => void download("json")}>
        {busy ? tr("Exporting…", "جارٍ التصدير…") : tr("Download selected configuration (JSON)", "تنزيل الإعدادات المختارة (JSON)")}
      </button>
      <button type="button" className="secondary-button"
        disabled={busy || selected.length !== 1 || !supportsCanonicalSpreadsheetReview(selected[0])}
        onClick={() => void downloadStaging("xlsx")}>
        {tr("Download review-ready DRAFT XLSX", "تنزيل XLSX متوافق مع مراجعة DRAFT")}
      </button>
      <button type="button" className="secondary-button"
        disabled={busy || selected.length !== 1 || !supportsCanonicalSpreadsheetReview(selected[0])}
        onClick={() => void downloadStaging("csv")}>
        {tr("Download review-ready DRAFT CSV", "تنزيل CSV متوافق مع مراجعة DRAFT")}
      </button>
      <button type="button" className="secondary-button" disabled={busy || selected.length !== 1}
        onClick={() => void download("xlsx")}>
        {tr("Download selected entity (Excel XLSX review)", "تنزيل العنصر المختار (Excel XLSX للمراجعة)")}
      </button>
      <button type="button" className="secondary-button" disabled={busy || selected.length !== 1}
        onClick={() => void download("csv")}>
        {tr("Download selected entity (CSV review)", "تنزيل العنصر المختار (CSV للمراجعة)")}
      </button>
    </div>
    <p className="muted">{tr(
      "Choose one group: human-review CSV/XLSX for all ten classes uses one atomic source and full field projection, but is NOT directly re-importable. Separate review-ready DRAFT CSV/XLSX maps nine supported classes and can be uploaded for review only. Reference intervals and complex contracts require qualified manual mapping. Nothing is a lossless restore or live activation.",
      "اختر مجموعة واحدة: ملفات CSV/XLSX للمراجعة البشرية لجميع الفئات العشر تستخدم لقطة مصدر ذرّية وحقولاً كاملة، لكنها ليست قابلة لإعادة الاستيراد مباشرة. ملفات DRAFT المنفصلة تدعم تسع فئات للمراجعة فقط. المجالات المرجعية والعقود المعقدة تحتاج مطابقة مهنية مؤهلة. لا توجد استعادة مطابقة أو تفعيل مباشر.",
    )}</p>
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
