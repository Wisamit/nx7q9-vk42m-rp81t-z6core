"use client";

import { useState } from "react";

type Row = {
  rowNumber: number;
  candidate: {
    priceListCode: string; testCode: string; unitPrice: string;
    effectiveFrom: string; effectiveTo: string;
  };
  currency: string | null;
  disposition: "BLOCKED" | "READY_FOR_GOVERNANCE";
  issues: string[];
};

export function PriceImportReconciliation({ batchId, locale }: {
  batchId: string; locale: "ar" | "en";
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reviewPage() {
    if (busy || !hasMore) return;
    setBusy(true);
    setError("");
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(batchId) + "/prices/reconcile"
        + (cursor ? "?after=" + cursor : "");
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json() as {
        rows?: Row[]; nextCursor?: number | null; hasMore?: boolean; error?: string;
      };
      if (!response.ok || !Array.isArray(body.rows)) throw new Error(body.error || "price_reconciliation_failed");
      setRows(current => [...current, ...body.rows!]);
      setCursor(body.nextCursor ?? null);
      setHasMore(Boolean(body.hasMore));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "price_reconciliation_failed");
    } finally {
      setBusy(false);
    }
  }

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Staged Price Reconciliation", "مطابقة الأسعار المستوردة")}</h2>
        <p className="muted">{tr(
          "Read-only reconciliation. This is NOT price approval or financial posting. No live price, invoice, currency, or historical record changes.",
          "مطابقة للمراجعة فقط، وليست اعتماداً للأسعار أو ترحيلاً مالياً. لا تعديل على الأسعار الفعلية أو الفواتير أو العملات أو السجلات التاريخية.",
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy || !hasMore}
        onClick={() => void reviewPage()}>
        {busy ? tr("Checking…", "جارٍ الفحص…") : rows.length === 0
          ? tr("Inspect staged prices", "فحص الأسعار المستوردة")
          : tr("Next 100 rows", "الـ100 صف التالية")}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    {rows.length > 0 && <div className="table-wrap"><table>
      <thead><tr>
        <th>#</th><th>{tr("Price list", "قائمة الأسعار")}</th><th>{tr("Test", "الفحص")}</th>
        <th>{tr("Exact price / currency", "السعر الدقيق / العملة")}</th>
        <th>{tr("Effective window", "فترة السريان")}</th>
        <th>{tr("Governance status", "حالة المراجعة")}</th>
        <th>{tr("Issues", "المشكلات")}</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.rowNumber}>
        <td>{row.rowNumber}</td>
        <td>{row.candidate.priceListCode}</td>
        <td>{row.candidate.testCode}</td>
        <td>{row.candidate.unitPrice} {row.currency ?? "—"}</td>
        <td>{row.candidate.effectiveFrom} – {row.candidate.effectiveTo || "∞"}</td>
        <td>{row.disposition === "READY_FOR_GOVERNANCE"
          ? tr("Mapped; approval required", "مطابق؛ يحتاج اعتماداً")
          : tr("Blocked", "محظور")}</td>
        <td>{row.issues.length ? row.issues.join(", ") : "—"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
