"use client";

import { useState } from "react";
import { parseStagedPriceReviewPage, type StagedPriceReviewRow } from "@/lib/staged-price-review-response";

const issueLabels: Record<string, [string, string]> = {
  OVERLAPPING_STAGED_PRICE_WINDOWS: ["Overlapping staged price windows", "تداخل فترات الأسعار المرحلية"],
  EXISTING_PRICE_WINDOW_COLLISION: ["Conflicts with an existing price window", "تعارض مع فترة سعر معتمدة"],
  OUTSIDE_PRICE_LIST_EFFECTIVE_WINDOW: ["Outside price list effective dates", "خارج فترة سريان قائمة الأسعار"],
  INVALID_EFFECTIVE_WINDOW: ["Invalid price effective dates", "تواريخ سريان السعر غير صحيحة"],
  PRICE_LIST_SCOPE_UNRESOLVED: ["Price list unavailable in your scope", "قائمة الأسعار خارج نطاق الصلاحية"],
  TEST_SCOPE_UNRESOLVED: ["Test unavailable in your clinical scope", "الفحص خارج نطاق الصلاحية السريرية"],
  ROW_ALREADY_PROCESSED: ["Row already processed", "تمت معالجة الصف مسبقاً"],
  STAGED_ROW_HAS_ERRORS: ["Row is not reviewable", "الصف غير مؤهل للمراجعة"],
  PRICE_LIST_NOT_ACTIVE_OR_AUTHORIZED: ["Price list not active or authorized", "قائمة الأسعار غير مفعّلة أو غير مصرّح بها"],
  TEST_NOT_ACTIVE_OR_AUTHORIZED: ["Test not active or authorized", "الفحص غير مفعّل أو غير مصرّح به"],
  PRICE_LIST_CURRENCY_INVALID: ["Price list currency needs review", "عملة قائمة الأسعار تحتاج مراجعة"],
};

export function PriceImportReconciliation({ batchId, locale }: {
  batchId: string; locale: "ar" | "en";
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [rows, setRows] = useState<StagedPriceReviewRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadPage(after: number, previousCursors: number[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(batchId) + "/prices/reconcile"
        + (after ? "?after=" + after : "");
      const response = await fetch(url, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const apiError = body && typeof body === "object" && "error" in body &&
          typeof body.error === "string" ? body.error : "price_reconciliation_failed";
        throw new Error(apiError);
      }
      // Fail closed before displaying financial candidates if the endpoint
      // no longer guarantees bounded, non-posting, approval-required review.
      const page = parseStagedPriceReviewPage(body, after);
      setRows(page.rows);
      setLoaded(true);
      setCursor(after);
      setHistory(previousCursors);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (caught) {
      // Preserve the last verified page after a failed request.
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
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => void loadPage(0, [])}>
        {busy ? tr("Checking…", "جارٍ الفحص…") : loaded
          ? tr("Restart review", "إعادة المراجعة")
          : tr("Inspect staged prices", "فحص الأسعار المستوردة")}
      </button>
    </div>
    {error && <p role="alert">{tr("Review unavailable: ", "تعذرت المراجعة: ")}{error}</p>}
    {loaded && <>
      <p className="muted">
        {tr("Page", "الصفحة")} {history.length + 1} · {rows.length} {tr("rows", "صفوف")}
        {" · "}{tr("Approval remains required", "يبقى الاعتماد إلزامياً")}
      </p>
      {rows.length === 0
        ? <p className="muted">{tr("No staged prices on this page.", "لا توجد أسعار مرحلية بهذه الصفحة.")}</p>
        : <div className="table-wrap"><table>
          <thead><tr>
            <th>#</th>
            <th>{tr("Price list / test", "قائمة الأسعار / الفحص")}</th>
            <th>{tr("Exact price / currency", "السعر الدقيق / العملة")}</th>
            <th>{tr("Effective window", "فترة السريان")}</th>
            <th>{tr("Governance status", "حالة المراجعة")}</th>
            <th>{tr("Issues", "المشكلات")}</th>
          </tr></thead>
          <tbody>{rows.map(row => {
            const visible = Boolean(row.candidate.priceListCode);
            return <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{visible
                ? <>{row.candidate.priceListCode} · {row.candidate.testCode}</>
                : tr("Restricted / unresolved", "محجوب / غير مطابق")}</td>
              <td>{visible ? <>{row.candidate.unitPrice} {row.currency ?? "—"}</> : "—"}</td>
              <td>{visible
                ? <>{row.candidate.effectiveFrom} – {row.candidate.effectiveTo || "∞"}</>
                : "—"}</td>
              <td>{row.disposition === "READY_FOR_GOVERNANCE"
                ? tr("Mapped; approval required", "مطابق؛ يحتاج اعتماداً")
                : tr("Blocked", "محظور")}</td>
              <td>{row.issues.length ? row.issues.map((code, i) =>
                <p key={i}><code>{code}</code> — {issueLabels[code]
                  ? issueLabels[code][locale === "ar" ? 1 : 0]
                  : tr("Needs review", "يحتاج مراجعة")}</p>) : "—"}</td>
            </tr>;
          })}</tbody>
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
