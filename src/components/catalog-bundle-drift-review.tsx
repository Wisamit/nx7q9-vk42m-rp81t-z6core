"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";

type DriftRow = {
  rowNumber: number; entityType: string;
  disposition: "UNCHANGED" | "DRIFTED"; changedFields: string[];
  additionalFieldsOmitted: boolean; observationToken: string;
  targetIdentity: {
    status: "LOCAL_IDENTITY_OBSERVED" | "MAPPING_REQUIRED";
    reasons: Array<
      "INVALID_SOURCE_IDENTITY" | "TARGET_RECORD_ID_MISMATCH" |
      "PRIMARY_CODE_MISMATCH" | "PARENT_IDENTITY_MISMATCH" |
      "BRANCH_OR_TARIFF_SCOPE_MISMATCH" | "COMPOSITE_MEMBERSHIP_MISMATCH" |
      "UNSUPPORTED_CLASS">;
    sourceInstanceProven: false; portableSourceIds: false;
    mappingApproved: false; reviewOnly: true; autoApplyAllowed: false;
  };
  fieldReview: {
    fields: Array<{ path: string; classification:
      "IMMUTABLE_SYSTEM" | "IDENTITY_RECONCILIATION" |
      "CLINICAL_VERSIONED_REVIEW" | "FINANCIAL_VERSIONED_REVIEW" |
      "CROSS_DOMAIN_VERSIONED_REVIEW" | "UNMAPPED_BLOCKED" }>;
    completeFieldInventory: boolean; unmappedFieldPresent: boolean;
    reviewOnly: true; autoApplyAllowed: false;
    qualifiedApprovalRequired: true; versionedApplicationRequired: true;
  };
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
  const [pendingReferral, setPendingReferral] = useState<DriftRow | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function flag(row: DriftRow) {
    if (busy || flagging !== null || !pendingReferral ||
        pendingReferral.rowNumber !== row.rowNumber ||
        pendingReferral.observationToken !== row.observationToken ||
        row.finding.canRefer !== true) return;
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
      setPendingReferral(null);
      setNotice(tr("Expert review requested. No configuration approved or changed.",
        "تمت إحالة السجل للمراجعة المختصة، دون اعتماد أو تغيير أي إعداد."));
      // The next comparison uses a fresh read and displays latest immutable evidence.
      await load(cursor, history);
    } catch (caught) {
      setPendingReferral(null);
      setError(caught instanceof Error ? caught.message : "triage_failed");
    } finally {
      setFlagging(null);
    }
  }

  async function load(after: number, previousCursors: number[]) {
    // A successful referral refreshes its source page while flagging is still set.
    if (busy) return;
    setPendingReferral(null);
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
            !row.targetIdentity || row.targetIdentity.reviewOnly !== true ||
            row.targetIdentity.autoApplyAllowed !== false ||
            row.targetIdentity.mappingApproved !== false ||
            row.targetIdentity.sourceInstanceProven !== false ||
            row.targetIdentity.portableSourceIds !== false ||
            !["LOCAL_IDENTITY_OBSERVED", "MAPPING_REQUIRED"]
              .includes(row.targetIdentity.status) ||
            !Array.isArray(row.targetIdentity.reasons) ||
            row.targetIdentity.reasons.length > 7 ||
            row.targetIdentity.reasons.some(reason => ![
              "INVALID_SOURCE_IDENTITY","TARGET_RECORD_ID_MISMATCH",
              "PRIMARY_CODE_MISMATCH","PARENT_IDENTITY_MISMATCH",
              "BRANCH_OR_TARIFF_SCOPE_MISMATCH","COMPOSITE_MEMBERSHIP_MISMATCH",
              "UNSUPPORTED_CLASS",
            ].includes(reason)) ||
            (row.targetIdentity.status === "LOCAL_IDENTITY_OBSERVED" !==
              (row.targetIdentity.reasons.length === 0)) ||
            !row.fieldReview || row.fieldReview.reviewOnly !== true ||
            row.fieldReview.autoApplyAllowed !== false ||
            row.fieldReview.qualifiedApprovalRequired !== true ||
            row.fieldReview.versionedApplicationRequired !== true ||
            typeof row.fieldReview.completeFieldInventory !== "boolean" ||
            typeof row.fieldReview.unmappedFieldPresent !== "boolean" ||
            !Array.isArray(row.fieldReview.fields) ||
            row.fieldReview.fields.length !== row.changedFields.length ||
            row.fieldReview.fields.some((field,index) =>
              field.path !== row.changedFields[index] ||
              !["IMMUTABLE_SYSTEM","IDENTITY_RECONCILIATION",
                "CLINICAL_VERSIONED_REVIEW","FINANCIAL_VERSIONED_REVIEW",
                "CROSS_DOMAIN_VERSIONED_REVIEW","UNMAPPED_BLOCKED"]
                .includes(field.classification)) ||
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
          "Read-only comparison of all ten catalog classes with field-risk labels. Existing grants permit review, not application or clinical/financial approval.",
          "مقارنة للقراءة فقط لفئات إعدادات المختبر العشر مع تصنيف مخاطر الحقول. الصلاحيات الحالية تسمح بالمراجعة، وليس التطبيق أو الاعتماد الطبي والمالي."
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy || flagging !== null || pendingReferral !== null}
        onClick={() => void load(0, [])}>
        {busy ? tr("Comparing…", "جارٍ المقارنة…") : loaded
          ? tr("Restart comparison", "إعادة المقارنة")
          : tr("Review live differences", "فحص الاختلافات الحالية")}
      </button>
    </div>
    {notice && <p role="status" className="muted">{notice}</p>}
    {error && <p role="alert">{tr("Comparison unavailable: ", "تعذرت المقارنة: ")}{error}</p>}
    <CrudModal open={pendingReferral !== null}
      onClose={() => { if (!busy && flagging === null) setPendingReferral(null); }}
      size="compact" protectUnsavedChanges={false}
      title={tr("Confirm referral to expert", "تأكيد الإحالة للمراجع المختص")}
      description={tr(
        "This creates a review flag only. Nothing is approved, released or changed in the live catalog.",
        "يسجل هذا الإجراء إحالة للمراجعة فقط، دون اعتماد أو نشر أو تعديل إعدادات الدليل الفعلي."
      )}>
      {pendingReferral && <div className="form-stack">
        <p><strong>{tr("Row", "السجل")}:</strong> {pendingReferral.rowNumber} · {pendingReferral.entityType}</p>
        <p><strong>{tr("Comparison", "المقارنة")}:</strong> {pendingReferral.disposition === "DRIFTED"
          ? tr("Differences found", "وُجدت اختلافات")
          : tr("Requires independent assessment", "تحتاج إلى تقييم مستقل")}</p>
        <p><strong>{tr("Field names only", "أسماء الحقول فقط")}:</strong> {
          pendingReferral.changedFields.length ? pendingReferral.changedFields.join(", ") : "—"}</p>
        <p className="muted">{tr(
          "The observation token and current permissions are checked again by the server when you confirm.",
          "يعيد الخادم فحص بصمة الملاحظة والصلاحيات الحالية عند تأكيد الإحالة."
        )}</p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="crud-modal-actions">
          <button type="button" className="secondary-button" disabled={busy || flagging !== null}
            onClick={() => setPendingReferral(null)}>{tr("Cancel", "إلغاء")}</button>
          <button type="button" className="primary-button" disabled={busy || flagging !== null ||
            !pendingReferral.finding.canRefer} onClick={() => void flag(pendingReferral)}>
            {flagging !== null ? tr("Recording…", "جارٍ التسجيل…")
              : tr("Record expert referral", "تسجيل الإحالة")}
          </button>
        </div>
      </div>}
    </CrudModal>
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
                : tr("Review differences", "توجد اختلافات للمراجعة")}
                <p className="muted">{row.targetIdentity.status === "LOCAL_IDENTITY_OBSERVED"
                  ? tr("Current local IDs match; source instance unproven",
                    "الهويات المحلية متطابقة حالياً، لكن نسخة المصدر غير مثبتة")
                  : tr("Target mapping requires separate review",
                    "ربط المصدر بالوجهة يحتاج مراجعة منفصلة")}</p>
                {row.targetIdentity.reasons.length > 0 &&
                  <p className="muted">{tr("Mapping flags: ", "ملاحظات الربط: ")}
                    {row.targetIdentity.reasons.join(", ")}</p>}</td>
              <td>{row.fieldReview.fields.length ? row.fieldReview.fields.map((field,index) => {
                const labels: Record<string,[string,string]> = {
                  IMMUTABLE_SYSTEM:["Immutable metadata", "بيانات نظامية غير قابلة للتعديل"],
                  IDENTITY_RECONCILIATION:["Identity / mapping review", "تطابق الهوية والربط"],
                  CLINICAL_VERSIONED_REVIEW:["Clinical versioned review", "مراجعة سريرية مع حفظ الإصدارات"],
                  FINANCIAL_VERSIONED_REVIEW:["Financial versioned review", "مراجعة مالية مع حفظ الإصدارات"],
                  CROSS_DOMAIN_VERSIONED_REVIEW:["Clinical + financial review", "مراجعة طبية ومالية"],
                  UNMAPPED_BLOCKED:["Unmapped / blocked", "حقل غير مصنّف ومحظور"],
                };
                return <p key={index}>{field.path} — {tr(...labels[field.classification])}</p>;
              }) : "—"}
                {!row.fieldReview.completeFieldInventory &&
                  <p className="muted">{tr("Field inventory incomplete; not eligible for application",
                    "قائمة الحقول غير مكتملة؛ غير مؤهلة للتطبيق")}</p>}</td>
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
                  disabled={busy || flagging !== null || pendingReferral !== null || !row.finding.canRefer}
                  onClick={() => { setError(""); setPendingReferral(row); }}>
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
