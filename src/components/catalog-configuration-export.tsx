"use client";

import { useState } from "react";
import { catalogReviewCsv } from "@/lib/catalog-review-csv";
import {
  catalogExportTypes, exportBundle, type CatalogExportType,
} from "@/lib/catalog-configuration-export";

const ordered: CatalogExportType[] = [
  "TEST", "COMPONENT", "UNIT", "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM",
];

export function CatalogConfigurationExport({
  locale, canExportPricing, canExportRanges,
}: { locale: "ar" | "en"; canExportPricing: boolean; canExportRanges: boolean }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [selected, setSelected] = useState<CatalogExportType[]>([
    "TEST", "COMPONENT", "UNIT",
    ...(canExportRanges ? ["REFERENCE_INTERVAL" as const] : []),
    ...(canExportPricing ? ["PRICE_LIST" as const, "PRICE_LIST_ITEM" as const] : []),
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const label = (t: CatalogExportType) => ({
    TEST: tr("Tests", "الفحوصات"),
    COMPONENT: tr("Result components", "مكوّنات النتائج"),
    UNIT: tr("Units (UCUM)", "الوحدات"),
    REFERENCE_INTERVAL: tr("Reference intervals and critical limits", "المجالات المرجعية والحدود الحرجة"),
    PRICE_LIST: tr("Price lists and scopes", "قوائم الأسعار ونطاقاتها"),
    PRICE_LIST_ITEM: tr("Prices and effective dates", "الأسعار وتواريخ السريان"),
  }[t]);

  async function download(format: "json" | "csv") {
    if (busy || selected.length === 0 || (format === "csv" && selected.length !== 1)) return;
    setBusy(true);
    setMessage("");
    try {
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
      const fileContents = format === "csv"
        ? catalogReviewCsv(groups[0], organizationId, exportedAt)
        : JSON.stringify(bundle, null, 2);
      const url = URL.createObjectURL(new Blob([fileContents], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "family-lab-catalog-" + (format === "csv" ? groups[0].entityType.toLowerCase() + "-" : "")
          + exportedAt.slice(0, 10) + "." + format;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      const total = groups.reduce((n, group) => n + group.records.length, 0);
      setMessage(format === "csv"
        ? tr("Exported " + total + " rows for review only. CSV protects against spreadsheet formulas but is not a lossless restore file. Use JSON for structured values. This export is not an atomic backup.",
          "تم تصدير " + total + " صف للمراجعة فقط. CSV يحدّ من صيغ الجداول الضارة لكنه ليس ملف استعادة مطابقاً للأصل. استخدم JSON للبيانات المهيكلة. التصدير ليس نسخة احتياطية ثابتة.")
        : tr("Exported " + total + " configuration records. This is a paged live export, not an atomic point-in-time backup. Import requires separate staged validation.",
          "تم تصدير " + total + " سجل إعدادات. هذا تصدير متسلسل للبيانات الحالية، وليس نسخة احتياطية ثابتة للحظة واحدة. إعادة الاستيراد تتطلب مراجعة مستقلة."));
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
        onClick={() => void download("csv")}>
        {tr("Download selected entity (CSV review)", "تنزيل العنصر المختار (CSV للمراجعة)")}
      </button>
    </div>
    <p className="muted">{tr(
      "For CSV, select exactly one category above. CSV is for spreadsheet review only; JSON preserves the original structured data and exact clinical/financial fields.",
      "لتنزيل CSV اختر نوع بيانات واحداً فقط. CSV للمراجعة في الجداول، أما JSON فيحفظ البنية الأصلية والقيم الطبية والمالية بدقتها.",
    )}</p>
    {message && <p role="status" className="muted">{message}</p>}
  </section>;
}
