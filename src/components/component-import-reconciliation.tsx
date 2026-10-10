"use client";

import { useState } from "react";

type ReconciliationRow = {
  rowNumber: number;
  rowStatus: string;
  candidate: { testCode: string; code: string; nameEn: string; unitCode: string; resultType: string } | null;
  disposition: "BLOCKED" | "READY_FOR_GOVERNANCE";
  issues: string[];
};

type ReconciliationResponse = {
  rows?: ReconciliationRow[];
  hasMore?: boolean;
  nextCursor?: number | null;
  liveWrites?: boolean;
  approvalRequired?: boolean;
  error?: string;
};

export function ComponentImportReconciliation({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  async function loadPage(after: number, previousCursors: number[]) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(batchId)
        + "/components/reconcile" + (after ? "?after=" + after : "");
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json() as ReconciliationResponse;
      if (!res.ok) throw new Error(body.error || "reconciliation_failed");

      // Reconciliation is never authorization for clinical master writes.
      // Refuse unbounded pages, invalid cursors or a changed posting contract.
      if (body.liveWrites !== false || body.approvalRequired !== true ||
          !Array.isArray(body.rows) || body.rows.length > 100 ||
          typeof body.hasMore !== "boolean" ||
          body.rows.some((row, index) =>
            !Number.isSafeInteger(row.rowNumber) || row.rowNumber <= after ||
            (index > 0 && row.rowNumber <= body.rows![index - 1].rowNumber) ||
            !["BLOCKED", "READY_FOR_GOVERNANCE"].includes(row.disposition) ||
            !Array.isArray(row.issues) ||
            (row.candidate === null && (row.disposition !== "BLOCKED" ||
              !row.issues.some(issue => ["ROW_ALREADY_PROCESSED", "STAGED_ROW_HAS_ERRORS",
                "PARENT_TEST_NOT_ACTIVE_OR_MISSING"].includes(issue)))) ||
            (row.candidate !== null && (typeof row.candidate !== "object" ||
              !["testCode", "code", "nameEn", "unitCode", "resultType"].every(
                field => typeof row.candidate?.[field as keyof NonNullable<ReconciliationRow["candidate"]>] === "string"))) ||
            (row.rowStatus !== "VALID" && row.rowStatus !== "WARNING" && row.candidate !== null)) ||
          (body.hasMore
            ? (!body.rows.length || !Number.isSafeInteger(body.nextCursor) ||
              body.nextCursor !== body.rows[body.rows.length - 1].rowNumber)
            : body.nextCursor !== null)) {
        throw new Error("unexpected_read_only_component_review_response");
      }

      // Keep only the current verified page; a request failure preserves it.
      setRows(body.rows);
      setLoaded(true);
      setCursor(after);
      setHistory(previousCursors);
      setNextCursor(body.nextCursor ?? null);
      setHasMore(body.hasMore);
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
      <button type="button" className="secondary-button" disabled={loading}
        onClick={() => void loadPage(0, [])}>
        {loading ? tr("Checking…", "جارٍ الفحص…") : loaded
          ? tr("Restart review", "إعادة المراجعة")
          : tr("Inspect component mappings", "فحص مطابقة المكونات")}
      </button>
    </div>
    {error && <p role="alert">{tr("Review unavailable: ", "تعذرت المراجعة: ")}{error}</p>}
    {loaded && <>
      <p className="muted">{tr("Page", "الصفحة")} {history.length + 1} · {rows.length} {tr("rows", "صفوف")}</p>
      {rows.length === 0
        ? <p className="muted">{tr("No staged components on this page.", "لا توجد مكوّنات مرحلية بهذه الصفحة.")}</p>
        : <div className="table-wrap"><table>
          <thead><tr>
            <th>#</th><th>{tr("Test", "الفحص")}</th><th>{tr("Component", "المكوّن")}</th>
            <th>{tr("Unit / type", "الوحدة / النوع")}</th><th>{tr("Mapping", "المطابقة")}</th>
            <th>{tr("Issues", "المشكلات")}</th>
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.rowNumber}>
            <td>{row.rowNumber}</td>
            <td>{row.candidate?.testCode || tr("Restricted / unresolved", "محجوب / غير مطابق")}</td>
            <td>{row.candidate ? <>{row.candidate.code} — {row.candidate.nameEn}</> : "—"}</td>
            <td>{row.candidate ? <>{row.candidate.unitCode || "—"} · {row.candidate.resultType || "—"}</> : "—"}</td>
            <td>{row.disposition === "READY_FOR_GOVERNANCE"
              ? tr("Mapping ready; approval still required", "المطابقة جاهزة؛ الاعتماد ما زال مطلوباً")
              : tr("Blocked", "محظور")}</td>
            <td>{row.issues.length ? row.issues.join(", ") : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      <div className="review-actions">
        <button type="button" className="secondary-button" disabled={loading || history.length === 0}
          onClick={() => void loadPage(history[history.length - 1], history.slice(0, -1))}>
          {tr("Previous 100 rows", "الـ100 صف السابقة")}
        </button>
        <button type="button" className="secondary-button" disabled={loading || !hasMore || nextCursor === null}
          onClick={() => { if (nextCursor !== null) void loadPage(nextCursor, [...history, cursor]); }}>
          {tr("Next 100 rows", "الـ100 صف التالية")}
        </button>
      </div>
    </>}
  </section>;
}
