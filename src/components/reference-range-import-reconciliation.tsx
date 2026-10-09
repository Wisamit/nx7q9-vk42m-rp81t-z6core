"use client";

import { useState } from "react";

type ReviewCandidate = {
  testName: string; unit: string; sex: string; ageFrom: string; ageTo: string;
  ageUnit: string; low: string; high: string; normalTextEn: string;
};
type ReviewRow = {
  rowNumber: number; rowStatus: string; candidate: ReviewCandidate | null;
  disposition: "BLOCKED" | "REVIEW_REQUIRED"; issues: string[];
};
type ReviewResponse = {
  rows?: ReviewRow[]; nextCursor?: number | null; hasMore?: boolean;
  liveWrites?: boolean; clinicalActivation?: boolean; approvalRequired?: boolean; error?: string;
};

const issueLabels: Record<string, [string, string]> = {
  CLINICAL_APPROVAL_AND_CONTEXT_REQUIRED: ["Clinical context and approval required", "يلزم تدقيق السياق والاعتماد السريري"],
  DUPLICATE_STAGED_RANGE_CONTEXT: ["Duplicate staged range context", "سياق مدى مرجعي مكرر في الملف"],
  CONFLICTING_STAGED_RANGE_CONTEXT: ["Conflicting staged range definitions", "تعارض تعريفات المدى المرجعي بالملف"],
  POTENTIAL_STAGED_AGE_WINDOW_OVERLAP: ["Potential overlap of age windows", "احتمال تداخل الفترات العمرية"],
  TEST_NOT_IN_CLINICAL_SCOPE: ["Test not accessible in clinical scope", "الفحص خارج النطاق السريري المسموح"],
  AMBIGUOUS_SCOPED_TEST: ["Ambiguous test match", "مطابقة الفحص غير محسومة"],
  UNIT_NOT_FOUND: ["Unit not found", "الوحدة غير موجودة"],
  AMBIGUOUS_UNIT: ["Ambiguous unit", "الوحدة غير محسومة"],
  COMPONENT_NOT_FOUND: ["Component not found", "المكوّن غير موجود"],
  MULTI_COMPONENT_REVIEW_REQUIRED: ["Multiple components require review", "وجود مكونات متعددة يتطلب المراجعة"],
  COMPONENT_UNIT_CONFLICT: ["Component and unit mismatch", "تعارض بين المكوّن والوحدة"],
  MISSING_TEST_OR_UNIT: ["Test or unit missing", "الفحص أو الوحدة مفقودة"],
  ROW_ALREADY_PROCESSED: ["Row already processed", "تمت معالجة الصف سابقاً"],
  ROW_NOT_REVIEWABLE: ["Row not eligible for review", "الصف غير مؤهل للمراجعة"],
};

export function ReferenceRangeImportReconciliation({
  batchId, locale,
}: { batchId: string; locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  async function loadPage(after: number, previousCursors: number[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(batchId) + "/ranges/reconcile"
        + (after ? "?after=" + after : "");
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json() as ReviewResponse;
      if (!response.ok || !Array.isArray(body.rows)) {
        throw new Error(body.error || "range_review_failed");
      }
      // Never present this preview as an approval or live clinical import.
      if (body.liveWrites !== false || body.clinicalActivation !== false ||
          body.approvalRequired !== true || body.rows.length > 100 ||
          body.rows.some(row => !Number.isSafeInteger(row.rowNumber) || row.rowNumber <= after ||
            !Array.isArray(row.issues) ||
            !["BLOCKED", "REVIEW_REQUIRED"].includes(row.disposition)) ||
          (body.hasMore && (!Number.isSafeInteger(body.nextCursor) ||
            (body.nextCursor ?? 0) <= after))) {
        throw new Error("unexpected_read_only_review_response");
      }
      setRows(body.rows);
      setCursor(after);
      setHistory(previousCursors);
      setNextCursor(body.nextCursor ?? null);
      setHasMore(Boolean(body.hasMore));
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "range_review_failed");
    } finally {
      setBusy(false);
    }
  }

  const ageText = (candidate: ReviewCandidate) =>
    candidate.ageFrom || candidate.ageTo
      ? (candidate.ageFrom || "—") + " – " + (candidate.ageTo || "—") + " " + candidate.ageUnit
      : tr("Unspecified", "غير محدد");

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Staged Reference Range Reconciliation", "مراجعة مطابقة المديات المرجعية المرحلية")}</h2>
        <p className="muted">{tr(
          "Read-only clinical review: exact test/component/unit matching with duplicate, conflict and possible age-overlap warnings. No reference range is approved, imported or activated.",
          "مراجعة سريرية للقراءة فقط: مطابقة الفحص والمكوّن والوحدة، وكشف التكرار والتعارض واحتمال تداخل الأعمار. لا يتم اعتماد أو استيراد أو تفعيل أي مدى مرجعي.",
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => void loadPage(0, [])}>
        {busy ? tr("Checking…", "جارٍ الفحص…") : loaded
          ? tr("Restart review", "إعادة المراجعة")
          : tr("Inspect staged reference ranges", "فحص المديات المرجعية المرحلية")}
      </button>
    </div>
    {error && <p role="alert">{tr("Review unavailable: ", "تعذرت المراجعة: ")}{error}</p>}
    {loaded && <>
      <p className="muted">{tr("Page", "الصفحة")} {history.length + 1} · {rows.length} {tr("rows", "صفوف")}
        {" · "}{tr("Medical approval remains required", "يبقى الاعتماد الطبي إلزامياً")}</p>
      {rows.length === 0 ? <p className="muted">{tr("No staged reference ranges on this page.", "لا توجد مديات مرجعية مرحلية بهذه الصفحة.")}</p> :
        <div className="table-wrap"><table>
          <thead><tr>
            <th>#</th>
            <th>{tr("Source test / unit", "الفحص / الوحدة بالمصدر")}</th>
            <th>{tr("Sex / age window", "الجنس / فترة العمر")}</th>
            <th>{tr("Source limits / text", "الحدود / النص بالمصدر")}</th>
            <th>{tr("Review status", "حالة المراجعة")}</th>
            <th>{tr("Warnings", "التحذيرات")}</th>
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.rowNumber}>
            <td>{row.rowNumber}</td>
            <td>{row.candidate ? <>{row.candidate.testName} · {row.candidate.unit}</> :
              tr("Restricted / unresolved", "محجوب / غير مطابق")}</td>
            <td>{row.candidate ? <>{row.candidate.sex || "—"} · {ageText(row.candidate)}</> : "—"}</td>
            <td>{row.candidate
              ? <>{row.candidate.low || "—"} – {row.candidate.high || "—"}
                  {row.candidate.normalTextEn ? <p>{row.candidate.normalTextEn}</p> : null}</>
              : "—"}</td>
            <td>{row.disposition === "REVIEW_REQUIRED"
              ? tr("Clinical review required", "بانتظار المراجعة السريرية")
              : tr("Blocked", "محظور")}</td>
            <td>{row.issues.length ? row.issues.map((code, i) =>
              <p key={i}><code>{code}</code> — {issueLabels[code]
                ? issueLabels[code][locale === "ar" ? 1 : 0] : tr("Needs review", "يحتاج مراجعة")}</p>)
              : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      <div className="review-actions">
        <button type="button" className="secondary-button" disabled={busy || history.length === 0}
          onClick={() => void loadPage(history[history.length - 1], history.slice(0, -1))}>
          {tr("Previous 100 rows", "الـ100 صف السابقة")}
        </button>
        <button type="button" className="secondary-button" disabled={busy || !hasMore || nextCursor === null}
          onClick={() => { if (nextCursor !== null) void loadPage(nextCursor, [...history, cursor]); }}>
          {tr("Next 100 rows", "الـ100 صف التالية")}
        </button>
      </div>
    </>}
  </section>;
}
