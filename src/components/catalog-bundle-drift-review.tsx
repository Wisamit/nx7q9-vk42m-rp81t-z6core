"use client";

import { useState } from "react";

type DriftRow = {
  rowNumber: number; entityType: string;
  disposition: "UNCHANGED" | "DRIFTED"; changedFields: string[];
  additionalFieldsOmitted: boolean; observationToken: string;
  finding: {
    status: "UNFLAGGED" | "AWAITING_EXPERT" | "EXPERT_CONFIRMED" |
      "RETURNED_FOR_CORRECTION" | "STALE_REVIEW_REQUIRED";
    canRefer: boolean; latestDisposition: "CONFIRM_FINDING" |
      "RETURN_FOR_CORRECTION" | null; awaitingFreshEvidence: boolean;
  };
  latestFlag?: { reasonCode: string; category: string; occurredAt: string } | null;
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
  const [flagging, setFlagging] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function flag(row: DriftRow) {
    if (busy || flagging !== null || row.finding.canRefer !== true) return;
    setFlagging(row.rowNumber);
    setNotice("");
    setError("");
    try {
      const reasonCode = row.disposition === "DRIFTED"
        ? "SOURCE_VALUE_CHANGED" : "REQUIRES_DOMAIN_ASSESSMENT";
      const response = await fetch("/api/catalog/imports/" + encodeURIComponent(batchId) +
        "/bundle-drift", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: row.rowNumber, observationToken: row.observationToken, reasonCode,
        }),
      });
      const result = await response.json() as {
        error?: string; status?: string; approved?: boolean; activated?: boolean; liveWrites?: boolean;
      };
      if (!response.ok || !["FLAGGED_FOR_EXPERT_REVIEW", "ALREADY_FLAGGED_FOR_EXPERT_REVIEW"].includes(result.status || "") ||
          result.approved !== false || result.activated !== false ||
          result.liveWrites !== false) {
        throw new Error(result.error || "triage_rejected");
      }
      setNotice(tr("Expert review requested. No configuration approved or changed.",
        "تمت إحالة السجل للمراجعة المختصة، دون اعتماد أو تغيير أي إعداد."));
      // The next comparison uses a fresh read and displays latest immutable evidence.
      await load(cursor, history);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "triage_failed");
    } finally {
      setFlagging(null);
    }
  }

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
            typeof row.additionalFieldsOmitted !== "boolean" ||
            !/^[a-f0-9]{64}$/.test(row.observationToken) ||
            !row.finding || ![
              "UNFLAGGED", "AWAITING_EXPERT", "EXPERT_CONFIRMED",
              "RETURNED_FOR_CORRECTION", "STALE_REVIEW_REQUIRED",
            ].includes(row.finding.status) ||
            typeof row.finding.canRefer !== "boolean" ||
            typeof row.finding.awaitingFreshEvidence !== "boolean" ||
            (row.finding.canRefer !== ["UNFLAGGED", "STALE_REVIEW_REQUIRED"]
              .includes(row.finding.status))) ||
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
    {notice && <p role="status" className="muted">{notice}</p>}
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
              <th>{tr("Review lifecycle", "حالة متابعة المراجعة")}</th>
              <th>{tr("Expert review triage (not approval)", "إحالة للمراجعة المختصة (ليست اعتماداً)")}</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.entityType}</td>
              <td>{row.disposition === "UNCHANGED"
                ? tr("Same as source", "مطابق للمصدر")
                : tr("Review differences", "توجد اختلافات للمراجعة")}</td>
              <td>{row.changedFields.length ? row.changedFields.join(", ") : "—"}
                {row.additionalFieldsOmitted && " …"}</td>
              <td>{row.finding.status === "UNFLAGGED"
                ? tr("Not referred", "لم تُحل للمراجعة")
                : row.finding.status === "AWAITING_EXPERT"
                ? tr("Awaiting independent reviewer", "بانتظار المراجع المستقل")
                : row.finding.status === "EXPERT_CONFIRMED"
                ? tr("Finding confirmed (not approved)", "تم تأكيد الملاحظة (دون اعتماد)")
                : row.finding.status === "RETURNED_FOR_CORRECTION"
                ? tr("Returned for correction", "أعيدت للتصحيح")
                : tr("Stale finding — new review required", "الملاحظة قديمة — تتطلب إحالة جديدة")}
              </td>
              <td>
                {row.latestFlag && <p className="muted">{tr("Previously flagged: ", "إحالة سابقة: ")}
                  {row.latestFlag.category} · {row.latestFlag.reasonCode}</p>}
                <button type="button" className="secondary-button"
                  disabled={busy || flagging !== null || !row.finding.canRefer}
                  onClick={() => void flag(row)}>
                  {flagging === row.rowNumber
                    ? tr("Recording…", "جارٍ التسجيل…")
                    : row.finding.status === "STALE_REVIEW_REQUIRED"
                    ? tr("Refer new observation", "إحالة الملاحظة الجديدة")
                    : row.finding.canRefer
                    ? tr("Flag for expert review", "إحالة للمراجعة المختصة")
                    : tr("Referral already in review history", "الإحالة موجودة بسجل المراجعة")}
                </button>
              </td>
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
