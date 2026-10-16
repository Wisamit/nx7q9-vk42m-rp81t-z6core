"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type AnalyzerOption = {
  id: string;
  code: string;
  name: string;
};

type AssignedRoute = {
  analyzerId: string;
  analyzerCodeSnapshot: string;
  analyzerNameSnapshot: string;
};

/** Routing decisions are explicit and audited; no analyzer command is sent by this UI. */
export function AnalyzerRoutingControl({
  orderItemId,
  assigned,
  candidates,
  canRoute,
  locale,
}: {
  orderItemId: string;
  assigned: AssignedRoute[];
  candidates: AnalyzerOption[];
  canRoute: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [selectedAnalyzerId, setSelectedAnalyzerId] = useState("");
  const [removeTarget, setRemoveTarget] = useState<AssignedRoute | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");

  const assignedIds = new Set(assigned.map(item => item.analyzerId));
  const availableCandidates = candidates.filter(item => !assignedIds.has(item.id));

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canRoute || !selectedAnalyzerId ||
        !availableCandidates.some(item => item.id === selectedAnalyzerId)) return;
    setBusy("assign");
    setFormError("");
    try {
      const response = await fetch("/api/worklists/" + orderItemId + "/analyzers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzerId: selectedAnalyzerId }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not assign analyzer.", "تعذر تعيين جهاز التحليل."));
        return;
      }
      setAssignOpen(false);
      setSelectedAnalyzerId("");
      setMessage(tr("Analyzer routing saved.", "تم حفظ توجيه جهاز التحليل."));
      router.refresh();
    } catch {
      setFormError(tr(
        "Connection interrupted; verify routing before retrying.",
        "انقطع الاتصال؛ تحقق من التوجيه قبل إعادة المحاولة.",
      ));
    } finally {
      setBusy("");
    }
  }

  async function clear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canRoute || !removeTarget ||
        !assigned.some(item => item.analyzerId === removeTarget.analyzerId)) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) {
      setFormError(tr("A documented removal reason is required.", "سبب إزالة التوجيه الموثق مطلوب."));
      return;
    }

    const analyzerId = removeTarget.analyzerId;
    setBusy(analyzerId);
    setFormError("");
    try {
      const response = await fetch("/api/worklists/" + orderItemId + "/analyzers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzerId, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not remove analyzer routing.", "تعذر إزالة توجيه جهاز التحليل."));
        return;
      }
      setRemoveTarget(null);
      setMessage(tr("Analyzer routing removed and audited.", "تمت إزالة توجيه الجهاز وتوثيقها."));
      router.refresh();
    } catch {
      setFormError(tr(
        "Connection interrupted; verify the current routing before retrying.",
        "انقطع الاتصال؛ تحقق من التوجيه الحالي قبل إعادة المحاولة.",
      ));
    } finally {
      setBusy("");
    }
  }

  return <div className="summary-list">
    {assigned.length === 0
      ? <span className="muted">{tr("Unassigned", "غير معيّن")}</span>
      : assigned.map(item => <div key={item.analyzerId}>
          <span>{item.analyzerCodeSnapshot}</span>
          <strong>{item.analyzerNameSnapshot}</strong>
          {canRoute && <button
            type="button"
            className="secondary-button"
            disabled={busy !== ""}
            onClick={() => { setMessage(""); setFormError(""); setRemoveTarget(item); }}
          >{busy === item.analyzerId ? tr("Removing…", "جارٍ الإزالة…") : tr("Remove", "إزالة")}</button>}
        </div>)}

    {canRoute && availableCandidates.length > 0 && <button
      type="button"
      className="secondary-button"
      disabled={busy !== ""}
      onClick={() => { setMessage(""); setFormError(""); setAssignOpen(true); }}
    >{tr("Assign analyzer", "تعيين جهاز تحليل")}</button>}

    {canRoute && assigned.length === 0 && availableCandidates.length === 0 &&
      <small className="muted">{tr(
        "No mapped analyzer is available at the specimen branch.",
        "لا يوجد جهاز تحليل مربوط ومتاح في فرع العينة.",
      )}</small>}

    {message && <small role="status" className="form-success">{message}</small>}

    <CrudModal open={assignOpen} onClose={() => { if (!busy) setAssignOpen(false); }}
      size="compact"
      title={tr("Assign Analyzer Routing", "تعيين توجيه جهاز التحليل")}
      description={tr(
        "Review the mapped analyzer for this work item and specimen branch. This records routing; it does not issue an analyzer command.",
        "راجع الجهاز المرتبط بعنصر العمل وفرع العينة. يسجل هذا الإجراء التوجيه ولا يرسل أمراً للجهاز.",
      )}>
      {assignOpen && <form className="catalog-form" onSubmit={assign}>
        <label className="form-span">{tr("Mapped analyzer", "جهاز التحليل المرتبط")}
          <select
            required
            value={selectedAnalyzerId}
            onChange={event => setSelectedAnalyzerId(event.target.value)}
            aria-label={tr("Assign analyzer", "تعيين جهاز تحليل")}
          >
            <option value="">{tr("Choose mapped analyzer…", "اختر جهازاً مرتبطاً…")}</option>
            {availableCandidates.map(item => <option key={item.id} value={item.id}>
              {item.code} — {item.name}</option>)}
          </select>
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span"
          disabled={busy !== "" || !selectedAnalyzerId}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm analyzer routing", "تأكيد توجيه الجهاز")}
        </button>
      </form>}
    </CrudModal>

    <CrudModal open={removeTarget !== null}
      onClose={() => { if (!busy) setRemoveTarget(null); }}
      size="compact"
      title={tr("Remove Analyzer Routing", "إزالة توجيه جهاز التحليل")}
      description={tr(
        "Removing an assigned analyzer requires an auditable reason. Prior analyzer measurements and raw interface messages remain traceable.",
        "تتطلب إزالة الجهاز سبباً موثقاً؛ تبقى القياسات السابقة ورسائل واجهة الجهاز الخام قابلة للتتبع.",
      )}>
      {removeTarget && <form key={removeTarget.analyzerId} className="catalog-form" onSubmit={clear}>
        <p className="form-span"><strong>{removeTarget.analyzerCodeSnapshot}</strong>
          {" — "}{removeTarget.analyzerNameSnapshot}</p>
        <label className="form-span">{tr("Documented routing removal reason", "السبب الموثق لإزالة التوجيه")}
          <textarea name="reason" rows={3} maxLength={1000} required />
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy !== ""}>
          {busy ? tr("Removing…", "جارٍ الإزالة…") : tr("Confirm routing removal", "تأكيد إزالة التوجيه")}
        </button>
      </form>}
    </CrudModal>
  </div>;
}
