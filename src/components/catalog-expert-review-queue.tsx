"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type Entry = {
  flagEventId: string; batchId: string; rowNumber: number;
  entityType: string; category: "CLINICAL" | "FINANCIAL" | "CATALOG";
  reasonCode: string; flaggedAt: string;
};
type Queue = {
  entries?: Entry[]; hasMore?: boolean; approval?: boolean; application?: boolean;
  error?: string;
};
type Decision = "CONFIRM_FINDING" | "RETURN_FOR_CORRECTION";
type Inspection = "CHECKING" | "READY" | "STALE" | "CONFLICT";

export function CatalogExpertReviewQueue({ locale }: { locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ entry: Entry; disposition: Decision } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inspections, setInspections] = useState<Record<string, Inspection>>({});

  async function refresh() {
    setInspections({});
    setPending(null);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/expert-review-queue", {
        cache: "no-store", credentials: "same-origin",
      });
      const data = await response.json() as Queue;
      if (!response.ok || !Array.isArray(data.entries) ||
          data.approval !== false || data.application !== false ||
          data.entries.length > 30 || data.entries.some(entry =>
            !/^[0-9a-f-]{36}$/i.test(entry.flagEventId) ||
            !/^[0-9a-f-]{36}$/i.test(entry.batchId) ||
            !Number.isSafeInteger(entry.rowNumber) || entry.rowNumber < 1 ||
            !["CLINICAL", "FINANCIAL"].includes(entry.category))) {
        throw new Error(data.error || "expert_queue_unavailable");
      }
      setEntries(data.entries);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "expert_queue_unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function inspect(entry: Entry) {
    if (busy || decisionId || pending) return;
    setError("");
    setNotice("");
    setInspections(previous => ({ ...previous, [entry.flagEventId]: "CHECKING" }));
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(entry.batchId) +
        "/bundle-drift?reviewFlagId=" + encodeURIComponent(entry.flagEventId);
      const response = await fetch(url, {
        cache: "no-store", credentials: "same-origin",
      });
      const data = await response.json() as {
        status?: string; category?: string; error?: string;
        approved?: boolean; activated?: boolean; liveWrites?: boolean;
      };
      if (response.ok && data.status === "EXPERT_REVIEW_READY" &&
          data.category === entry.category && data.approved === false &&
          data.activated === false && data.liveWrites === false) {
        setInspections(previous => ({ ...previous, [entry.flagEventId]: "READY" }));
      } else {
        const stale = ["expert_evidence_stale", "expert_flag_not_found", "review_not_open"]
          .includes(data.error || "");
        setInspections(previous => ({
          ...previous, [entry.flagEventId]: stale ? "STALE" : "CONFLICT",
        }));
        setError(tr(
          "Review is not ready. Recheck permissions, latest evidence or an earlier decision. " +
          "No action was recorded.",
          "المراجعة غير جاهزة. تحقّق من الصلاحيات والبصمة الحالية أو وجود قرار سابق. " +
          "لم يُسجل أي قرار.",
        ));
      }
    } catch {
      setInspections(previous => ({ ...previous, [entry.flagEventId]: "CONFLICT" }));
      setError(tr("Could not verify this review. No action was recorded.",
        "تعذّر التحقق من هذه الإحالة، ولم يُسجل أي قرار."));
    }
  }

  async function decide(entry: Entry, disposition: Decision) {
    if (busy || decisionId || !pending || pending.entry.flagEventId !== entry.flagEventId ||
        pending.disposition !== disposition || inspections[entry.flagEventId] !== "READY") return;
    // PUT independently validates all scopes and current HMAC after this preview.
    setDecisionId(entry.flagEventId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/catalog/imports/" +
        encodeURIComponent(entry.batchId) + "/bundle-drift", {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagEventId: entry.flagEventId, disposition }),
      });
      const result = await response.json() as {
        error?: string; status?: string; approved?: boolean; activated?: boolean;
        liveWrites?: boolean;
      };
      if (!response.ok || !["EXPERT_DECISION_RECORDED", "EXPERT_DECISION_ALREADY_RECORDED"]
        .includes(result.status || "") || result.approved !== false ||
        result.activated !== false || result.liveWrites !== false) {
        throw new Error(result.error || "expert_decision_rejected");
      }
      setInspections({});
      setPending(null);
      setNotice(tr("Review disposition recorded. No configuration was approved or activated.",
        "تم تسجيل قرار المراجعة، دون اعتماد أو تفعيل أي إعداد."));
      await refresh();
    } catch (caught) {
      setPending(null);
      setInspections(previous => ({ ...previous, [entry.flagEventId]: "CONFLICT" }));
      setError(caught instanceof Error ? caught.message : "expert_decision_rejected");
    } finally {
      setDecisionId(null);
    }
  }

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Independent expert review queue", "قائمة المراجعة المختصة المستقلة")}</h2>
        <p className="muted">{tr(
          "For a second authorized reviewer, separate from the source author. Decisions concern flagged differences only. They never approve clinical or financial values, and never change the live LIS.",
          "لمراجع ثانٍ مخوّل ومختلف عن صاحب ملف المصدر. القرارات تخصّ الاختلافات المحالة فقط، ولا تعتمد قيماً طبية أو مالية ولا تغيّر بيانات النظام الحية."
        )}</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => void refresh()}
        disabled={busy || decisionId !== null || pending !== null}>
        {busy ? tr("Checking…", "جارٍ الفحص…") : tr("Refresh pending findings", "تحديث الإحالات المعلقة")}
      </button>
    </div>
    {notice && <p role="status" className="muted">{notice}</p>}
    {error && <p role="alert">{tr("Review unavailable: ", "تعذرت المراجعة: ")}{error}</p>}
    <CrudModal open={pending !== null}
      onClose={() => { if (!busy && decisionId === null) setPending(null); }}
      size="compact" protectUnsavedChanges={false}
      title={tr("Confirm independent review record", "تأكيد تسجيل المراجعة المستقلة")}
      description={tr(
        "This is an audit disposition only; no clinical or financial master is approved.",
        "هذا قرار مراجعة يُسجل في التدقيق فقط، ولا يعتمد بيانات طبية أو مالية."
      )}>
      {pending && <div className="form-stack">
        <p><strong>{tr("Row", "السجل")}:</strong> {pending.entry.rowNumber} · {pending.entry.entityType}</p>
        <p><strong>{tr("Domain", "الاختصاص")}:</strong> {pending.entry.category === "CLINICAL"
          ? tr("Clinical", "طبي") : tr("Financial", "مالي")}</p>
        <p><strong>{tr("Finding", "الملاحظة")}:</strong> {pending.entry.reasonCode}</p>
        <p><strong>{tr("Decision", "القرار")}:</strong> {pending.disposition === "CONFIRM_FINDING"
          ? tr("Confirm finding (NOT approval)", "تأكيد الملاحظة (ليس اعتماداً)")
          : tr("Return for correction", "إعادة للتصحيح")}</p>
        <p className="muted">{tr(
          "The server rechecks current evidence and reviewer independence before recording. No settings are activated.",
          "يعيد الخادم فحص الدليل الحالي واستقلال المراجع قبل التسجيل، ولا يتم تفعيل أي إعدادات."
        )}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="crud-modal-actions">
          <button type="button" className="secondary-button" disabled={decisionId !== null || busy}
            onClick={() => setPending(null)}>{tr("Cancel", "إلغاء")}</button>
          <button type="button" className="primary-button" disabled={decisionId !== null || busy ||
            inspections[pending.entry.flagEventId] !== "READY"}
            onClick={() => void decide(pending.entry, pending.disposition)}>
            {decisionId !== null ? tr("Recording…", "جارٍ التسجيل…") : tr("Record audit decision", "تسجيل قرار المراجعة")}
          </button>
        </div>
      </div>}
    </CrudModal>
    {loaded && (entries.length === 0
      ? <p className="muted">{tr("No accessible pending findings for this branch.",
          "لا توجد إحالات معلقة مصرح بها ضمن هذا الفرع.")}</p>
      : <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Row", "السجل")}</th>
          <th>{tr("Category", "الفئة")}</th>
          <th>{tr("Type", "النوع")}</th>
          <th>{tr("Reason", "السبب")}</th>
          <th>{tr("Flagged at (UTC)", "وقت تسجيل الملاحظة (UTC)")}</th>
          <th>{tr("Independent review disposition", "قرار المراجعة المستقلة")}</th>
        </tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.flagEventId}>
          <td>{entry.rowNumber}</td>
          <td>{entry.category === "CLINICAL" ? tr("Clinical", "طبي")
            : tr("Financial", "مالي")}</td>
          <td>{entry.entityType}</td>
          <td>{entry.reasonCode}</td>
          <td><SystemDateText value={entry.flaggedAt} timeZone="UTC" /></td>
          <td>
            <button type="button" className="secondary-button"
              disabled={busy || decisionId !== null ||
                inspections[entry.flagEventId] === "CHECKING"}
              onClick={() => void inspect(entry)}>
              {inspections[entry.flagEventId] === "CHECKING"
                ? tr("Verifying live data…", "جارٍ فحص البيانات الحية…")
                : tr("Verify current evidence", "فحص الدليل الحالي")}
            </button>
            {inspections[entry.flagEventId] === "READY" &&
              <p className="muted">{tr(
                "Current evidence matches. Final action rechecks it again.",
                "الدليل الحالي مطابق، وسيُعاد التحقق عند تسجيل القرار.",
              )}</p>}
            {inspections[entry.flagEventId] === "STALE" &&
              <p className="muted">{tr(
                "Stale or replaced referral: a new source-author referral is required.",
                "الإحالة قديمة أو مستبدلة، وتحتاج إحالة جديدة من صاحب المصدر.",
              )}</p>}
            {inspections[entry.flagEventId] === "CONFLICT" &&
              <p className="muted">{tr(
                "Conflict or access changed. Expert action unavailable.",
                "يوجد تعارض أو تغيّر في الصلاحية. القرار غير متاح.",
              )}</p>}
            <button type="button" className="secondary-button"
              disabled={busy || decisionId !== null ||
                inspections[entry.flagEventId] !== "READY"}
              onClick={() => { setError(""); setPending({ entry, disposition: "CONFIRM_FINDING" }); }}>
              {tr("Confirm finding (not approval)", "تأكيد الملاحظة (ليس اعتماداً)")}
            </button>{" "}
            <button type="button" className="secondary-button"
              disabled={busy || decisionId !== null ||
                inspections[entry.flagEventId] !== "READY"}
              onClick={() => { setError(""); setPending({ entry, disposition: "RETURN_FOR_CORRECTION" }); }}>
              {tr("Return for correction", "إعادة للتصحيح")}
            </button>
          </td>
        </tr>)}</tbody>
      </table></div>
    )}
  </section>;
}
