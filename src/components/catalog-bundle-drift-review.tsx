"use client";

import { useState } from "react";

type DriftRow = {
  rowNumber: number; entityType: string;
  disposition: "UNCHANGED" | "DRIFTED"; changedFields: string[];
  additionalFieldsOmitted: boolean;
};
type DriftResponse = {
  rows?: DriftRow[]; nextCursor?: number | null; hasMore?: boolean;
  sourceVerified?: boolean; liveWrites?: boolean; clinicalActivation?: boolean;
  priceActivation?: boolean; approvalRequired?: boolean; reviewedAt?: string;
  error?: string;
};

export function CatalogBundleDriftReview({ batchId, locale }: {
  batchId: string; locale: "ar" | "en";
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<DriftRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sourceVerified, setSourceVerified] = useState(false);
  const [reviewedAt, setReviewedAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(after: number, previousCursors: number[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/" + encodeURIComponent(batchId)
        + "/bundle-drift" + (after ? "?after=" + after : ""), { cache: "no-store" });
      const data = await response.json() as DriftResponse;
      if (!response.ok || !Array.isArray(data.rows)) throw new Error(data.error || "bundle_drift_failed");
      if (data.liveWrites !== false || data.clinicalActivation !== false ||
          data.priceActivation !== false || data.approvalRequired !== true ||
          data.rows.length > 100 || typeof data.sourceVerified !== "boolean" ||
          data.rows.some(row =>
            !Number.isSafeInteger(row.rowNumber) || row.rowNumber <= after ||
            !["UNCHANGED", "DRIFTED"].includes(row.disposition) ||
            !Array.isArray(row.changedFields) ||
            row.changedFields.some(field => typeof field !== "string") ||
            typeof row.additionalFieldsOmitted !== "boolean") ||
          (data.hasMore === true &&
            (!Number.isSafeInteger(data.nextCursor) || (data.nextCursor ?? 0) <= after))) {
        throw new Error("unexpected_reconciliation_response");
      }
      setRows(data.rows);
      setCursor(after);
      setHistory(previousCursors);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(data.hasMore === true);
      setSourceVerified(data.sourceVerified);
      setReviewedAt(data.reviewedAt || "");
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "bundle_drift_failed");
    } finally {
      setBusy(false);
    }
  }

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Compare staged bundle with live configuration", "مقارنة ملف الإعدادات مع البيانات الحية")}</h2>
        <p className="muted">{tr(
          "Read-only comparison of all six catalog classes. Checks current branch, department, clinical and financial permissions. Shows changed field names only; it never approves, activates or overwrites settings.",
          "مقارنة للقراءة فقط لأنواع إعدادات المختبر الستة. تعيد فحص صلاحيات الفروع والأقسام والإعدادات الطبية والمالية. تعرض أسماء الحقول المختلفة فقط، ولا تعتمد أو تفعّل أو تستبدل أي بيانات."
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => void load(0, [])}>
        {busy ? tr("Comparing…", "جارٍ المقارنة…") : loaded
          ? tr("Restart comparison", "إعادة المقارنة")
          : tr("Review live differences", "فحص الاختلافات الحالية")}
      </button>
    </div>
    {error && <p role="alert">{tr("Comparison unavailable: ", "تعذرت المقارنة: ")}{error}</p>}
    {loaded && <>
      <p className="muted">{sourceVerified
        ? tr("Signed source verified at original staging; this comparison is not an approval.",
          "تم التحقق من توقيع المصدر عند تجهيز المراجعة؛ هذه المقارنة ليست اعتماداً.")
        : tr("Unsigned/unverified source; comparisons cannot establish export authenticity.",
          "مصدر غير موثّق؛ المقارنة لا تثبت أصالة ملف التصدير.")}</p>
      <p className="muted">{tr("Page", "الصفحة")} {history.length + 1} · {rows.length} {tr("rows", "صفوف")}
        {reviewedAt ? " · " + reviewedAt : ""}</p>
      {rows.length === 0
        ? <p className="muted">{tr("No more staged records.", "لا توجد سجلات مرحلية إضافية.")}</p>
        : <div className="table-wrap"><table>
            <thead><tr>
              <th>#</th>
              <th>{tr("Entity", "الكيان")}</th>
              <th>{tr("Comparison", "نتيجة المقارنة")}</th>
              <th>{tr("Changed field names (not values)", "أسماء الحقول المختلفة (دون قيم)")}</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.entityType}</td>
              <td>{row.disposition === "UNCHANGED"
                ? tr("Same as source", "مطابق للمصدر")
                : tr("Review differences", "توجد اختلافات للمراجعة")}</td>
              <td>{row.changedFields.length ? row.changedFields.join(", ") : "—"}
                {row.additionalFieldsOmitted && " …"}</td>
            </tr>)}</tbody>
          </table></div>}
      <div className="review-actions">
        <button type="button" className="secondary-button" disabled={busy || !history.length}
          onClick={() => void load(history[history.length - 1], history.slice(0, -1))}>
          {tr("Previous 100", "الـ100 السابقة")}
        </button>
        <button type="button" className="secondary-button"
          disabled={busy || !hasMore || nextCursor === null}
          onClick={() => { if (nextCursor !== null) void load(nextCursor, [...history, cursor]); }}>
          {tr("Next 100", "الـ100 التالية")}
        </button>
      </div>
    </>}
  </section>;
}
