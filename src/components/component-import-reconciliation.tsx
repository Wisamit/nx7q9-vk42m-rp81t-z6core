"use client";

import { useState } from "react";

type ReconciliationRow = {
  rowNumber: number;
  candidate: { testCode: string; code: string; nameEn: string; unitCode: string; resultType: string };
  disposition: string;
  issues: string[];
};

export function ComponentImportReconciliation({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<number | null>(0);
  const [hasMore, setHasMore] = useState(true);

  async function inspect() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/imports/" + encodeURIComponent(batchId)
        + "/components/reconcile" + (cursor ? "?after=" + cursor : ""), { cache: "no-store" });
      const body = await res.json() as {
        rows?: ReconciliationRow[]; hasMore?: boolean; nextCursor?: number | null; error?: string;
      };
      if (!res.ok || !Array.isArray(body.rows)) throw new Error(body.error || "reconciliation_failed");
      setRows(current => [...current, ...body.rows!]);
      setCursor(body.nextCursor ?? null);
      setHasMore(Boolean(body.hasMore));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "reconciliation_failed");
    } finally {
      setLoading(false);
    }
  }

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Component Import Reconciliation", "مطابقة مكونات التحاليل المستوردة")}</h2>
        <p className="muted">{tr(
          "Read-only mapping review. Ready means mapped for governance, NOT approved for live import. No component, reference interval or historical result is changed.",
          "مطابقة للمراجعة فقط. الجاهزية تعني صلاحية العرض للحوكمة، وليست موافقة على الاستيراد الفعلي. لن تُعدَّل المكونات أو المديات المرجعية أو النتائج التاريخية.",
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={loading || !hasMore} onClick={() => void inspect()}>
        {loading ? tr("Checking…", "جارٍ الفحص…") : rows.length === 0
          ? tr("Inspect component mappings", "فحص مطابقة المكونات")
          : tr("Next 100 rows", "الـ100 صف التالية")}
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    {rows.length > 0 && <div className="table-wrap"><table>
      <thead><tr>
        <th>#</th><th>{tr("Test", "الفحص")}</th><th>{tr("Component", "المكوّن")}</th>
        <th>{tr("Unit / type", "الوحدة / النوع")}</th><th>{tr("Mapping", "المطابقة")}</th>
        <th>{tr("Issues", "المشكلات")}</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.rowNumber}>
        <td>{row.rowNumber}</td>
        <td>{row.candidate.testCode}</td>
        <td>{row.candidate.code} — {row.candidate.nameEn}</td>
        <td>{row.candidate.unitCode || "—"} · {row.candidate.resultType || "—"}</td>
        <td>{row.disposition === "READY_FOR_GOVERNANCE"
          ? tr("Mapping ready; approval still required", "المطابقة جاهزة؛ الاعتماد ما زال مطلوباً")
          : tr("Blocked", "محظور")}</td>
        <td>{row.issues.length ? row.issues.join(", ") : "—"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
