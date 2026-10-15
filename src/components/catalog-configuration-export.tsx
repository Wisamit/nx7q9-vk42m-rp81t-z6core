"use client";

import { useState } from "react";
import { catalogReviewCsv } from "@/lib/catalog-review-csv";
import { catalogReviewXlsx } from "@/lib/catalog-review-xlsx";
import {
  catalogExportTypes, exportBundle, type CatalogExportType,
} from "@/lib/catalog-configuration-export";

const ordered: CatalogExportType[] = [
  "TEST", "COMPONENT", "UNIT", "PANEL", "PACKAGE",
  "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM",
];

export function CatalogConfigurationExport({
  locale, canExportPricing, canExportRanges,
}: { locale: "ar" | "en"; canExportPricing: boolean; canExportRanges: boolean }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [selected, setSelected] = useState<CatalogExportType[]>([
    "TEST", "COMPONENT", "UNIT", "PANEL", "PACKAGE",
    ...(canExportRanges ? ["REFERENCE_INTERVAL" as const] : []),
    ...(canExportPricing ? ["PRICE_LIST" as const, "PRICE_LIST_ITEM" as const, "PRICE_LIST_PACKAGE_ITEM" as const] : []),
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = (t: CatalogExportType) => ({
    TEST: tr("Tests", "الفحوصات"),
    COMPONENT: tr("Result components", "مكوّنات النتائج"),
    UNIT: tr("Units (UCUM)", "الوحدات"),
    PANEL: tr("Test panels and full membership", "مجموعات الفحوصات وكامل عضويتها"),
    PACKAGE: tr("Commercial packages and their tests", "الباقات التجارية والفحوصات التابعة لها"),
    REFERENCE_INTERVAL: tr("Reference intervals and critical limits", "المجالات المرجعية والحدود الحرجة"),
    PRICE_LIST: tr("Price lists and scopes", "قوائم الأسعار ونطاقاتها"),
    PRICE_LIST_ITEM: tr("Prices and effective dates", "الأسعار وتواريخ السريان"),
    PRICE_LIST_PACKAGE_ITEM: tr("Package prices and effective dates", "أسعار الباقات وتواريخ السريان"),
  }[t]);

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
        const bundle = JSON.parse(text) as {
          format?: string; schemaVersion?: number; consistency?: string;
          groups?: Array<{entityType:string; records: unknown[]}>;
        };
        if (bundle.format !== "family-lab-catalog-bundle" || bundle.schemaVersion !== 1 ||
            bundle.consistency !== "transactional-consistent-read" ||
            !Array.isArray(bundle.groups) || bundle.groups.length !== types.length ||
            bundle.groups.some((group, index) =>
              group.entityType !== types[index] || !Array.isArray(group.records))) {
          throw new Error("atomic_bundle_invalid");
        }
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
      let organizationId: string | null = null;
      const groups: Array<{ entityType: CatalogExportType; records: unknown[] }> = [];
      for (const entityType of ordered.filter(t => selected.includes(t))) {
        const records: unknown[] = [];
        let cursor: string | null = null;
        let finished = false;
        for (let page = 0; page < 200; page++) {
          const qs = new URLSearchParams({ entityType });
          if (cursor) qs.set("cursor", cursor);
          const response = await fetch("/api/catalog/configuration-export?" + qs.toString(), {
            cache: "no-store", credentials: "same-origin",
          });
          if (!response.ok) throw new Error("export_request_failed_" + response.status);
          const data = await response.json() as {
            format?: string; schemaVersion?: number; entityType?: string;
            organizationId?: string; records?: unknown[];
            nextCursor?: string | null; hasMore?: boolean;
          };
          if (data.format !== "family-lab-catalog-export" || data.schemaVersion !== 1
            || data.entityType !== entityType || !data.organizationId
            || !Array.isArray(data.records) || data.records.length > 250
            || (organizationId !== null && organizationId !== data.organizationId)
            || !catalogExportTypes.has(data.entityType as CatalogExportType)) {
            throw new Error("export_payload_invalid");
          }
          organizationId = data.organizationId;
          records.push(...data.records);
          if (data.hasMore !== true) {
            finished = true;
            break;
          }
          if (!data.nextCursor || data.nextCursor === cursor) throw new Error("export_cursor_invalid");
          cursor = data.nextCursor;
        }
        if (!finished) throw new Error("export_too_large_to_download_safely");
        groups.push({ entityType, records });
      }
      if (!organizationId) throw new Error("export_organization_missing");
      const exportedAt = new Date().toISOString();
      const bundle = exportBundle(groups, organizationId, exportedAt);
      const csvText = catalogReviewCsv(groups[0], organizationId, exportedAt);
      const fileContents = format === "xlsx" ? catalogReviewXlsx(csvText) : csvText;
      const part: BlobPart = typeof fileContents === "string" ? fileContents :
        fileContents.buffer.slice(fileContents.byteOffset, fileContents.byteOffset + fileContents.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([part], {
        type: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8",
      }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "family-lab-catalog-" + (groups[0].entityType.toLowerCase() + "-")
          + exportedAt.slice(0, 10) + "." + format;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      const total = groups.reduce((n, group) => n + group.records.length, 0);
      setMessage(format === "xlsx"
        ? tr("Exported " + total + " Excel rows for human review only. All cells are literal text; this paged export is neither an atomic backup nor a directly activatable import.",
          "تم تصدير " + total + " صف إلى Excel للمراجعة البشرية فقط. جميع الخلايا نصية، والتصدير ليس نسخة ثابتة أو استيراداً قابلًا للتفعيل مباشرة.")
        : tr("Exported " + total + " rows for review only. CSV protects against spreadsheet formulas but is not a lossless restore file. Use JSON for structured values. This export is not an atomic backup.",
          "تم تصدير " + total + " صف للمراجعة فقط. CSV يحدّ من صيغ الجداول الضارة لكنه ليس ملف استعادة مطابقاً للأصل. استخدم JSON للبيانات المهيكلة. التصدير ليس نسخة احتياطية ثابتة.")
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
      "For CSV or Excel XLSX select one category. Both are human-review exports, not direct imports or database restore files; signed JSON preserves structured values.",
      "لتنزيل CSV أو Excel XLSX اختر نوعاً واحداً فقط. كلاهما للمراجعة البشرية وليس للاستعادة أو التفعيل المباشر؛ JSON الموقّع يحفظ البيانات الأصلية المهيكلة.",
    )}</p>
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
