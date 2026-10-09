"use client";

import { useState } from "react";

type PriceRow = {
  rowNumber: number;
  candidate: { priceListCode: string; testCode: string; unitPrice: string; effectiveFrom: string; effectiveTo: string };
  currency: string | null;
  disposition: string;
  issues: string[];
};
export function PriceImportReconciliation({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/" + encodeURIComponent(batchId)
        + "/prices/reconcile" + (cursor ? "?after=" + cursor : ""), { cache: "no-store" });
      const data = await response.json() as {
        rows?: PriceRow[]; hasMore?: boolean; nextCursor?: number | null; error?: string;
      };
      if (!response.ok || !Array.isArray(data.rows)) throw new Error(data.error || "price_reconciliation_failed");
      setRows(current => [...current, ...data.rows!]);
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "price_reconciliation_failed");
    } finally { setLoading(false); }
  }
  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Price Import Reconciliation", "مطابقة الأسعار المستوردة")}</h2>
        <p className="muted">{tr(
          "Review only. Ready means eligible for a separate financial approval, not authorization to change prices. Historical invoices remain unchanged.",
          "للمراجعة فقط. الجاهزية لا تعني الموافقة المالية ولا تغيير الأسعار. الفواتير التاريخية لا تتغير.",
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={loading || !hasMore}
        onClick={() => void inspect()}>
        {loading ? tr("Checking…", "جارٍ الفحص…") : rows.length === 0
          ? tr("Inspect price mappings", "فحص مطابقة الأسعار")
          : tr("Next 100 rows", "الـ100 صف التالية")}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    {rows.length > 0 && <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>{tr("Price list", "قائمة الأسعار")}</th>
        <th>{tr("Test", "الفحص")}</th><th>{tr("Staged price / currency", "السعر المرحلي / العملة")}</th>
        <th>{tr("Effective dates", "تواريخ السريان")}</th>
        <th>{tr("Review status", "حالة المراجعة")}</th><th>{tr("Issues", "المشكلات")}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.rowNumber}>
        <td>{row.rowNumber}</td><td>{row.candidate.priceListCode}</td>
        <td>{row.candidate.testCode}</td>
        <td>{row.candidate.unitPrice} {row.currency || "—"}</td>
        <td>{row.candidate.effectiveFrom} → {row.candidate.effectiveTo || "∞"}</td>
        <td>{row.disposition === "READY_FOR_GOVERNANCE"
          ? tr("Mapping ready; approval required", "المطابقة جاهزة؛ الاعتماد مطلوب")
          : tr("Blocked", "محظور")}</td>
        <td>{row.issues.join(", ") || "—"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
