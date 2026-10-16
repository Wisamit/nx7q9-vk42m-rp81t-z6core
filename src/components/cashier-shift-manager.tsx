"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type BranchOption = { id: string; code: string; name: string; defaultCurrency: string };
type ShiftRow = {
  id: string;
  shiftNumber: string;
  branchCode: string;
  branchName: string;
  cashierName: string;
  cashierUserId: string;
  currency: string;
  openingCash: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  latestClosure: null | {
    id: string;
    attemptNumber: number;
    status: string;
    cashReceipts: string;
    cashRefunds: string;
    expectedCash: string;
    actualCash: string;
    differenceAmount: string;
    submittedAt: string;
    notes: string | null;
    reviewNote: string | null;
  };
};

export function CashierShiftManager({
  locale,
  currentUserId,
  canManage,
  canApprove,
  branches,
  shifts,
  defaultBranchId,
}: {
  locale: "ar" | "en";
  currentUserId: string;
  canManage: boolean;
  canApprove: boolean;
  branches: BranchOption[];
  shifts: ShiftRow[];
  defaultBranchId: string | null;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [closing, setClosing] = useState<ShiftRow | null>(null);
  const [reviewing, setReviewing] = useState<{ shift: ShiftRow; action: "APPROVE" | "REJECT" } | null>(null);
  const defaultBranch = branches.find(item => item.id === defaultBranchId) || branches[0];

  function errorText(code: string) {
    const messages: Record<string, string> = {
      active_shift_already_exists: tr("An active shift already exists for this branch and currency.", "توجد وردية نشطة بالفعل لهذا الفرع وهذه العملة."),
      shift_changed: tr("The shift changed while closing. Refresh and review the latest transactions.", "تغيرت الوردية أثناء الإغلاق. حدّث الصفحة وراجع أحدث العمليات."),
      shift_not_open: tr("This shift is no longer open.", "هذه الوردية لم تعد مفتوحة."),
      cashier_mismatch: tr("Only the cashier who opened the shift can submit its closing.", "فقط أمين الصندوق الذي فتح الوردية يمكنه إرسال إغلاقها."),
      self_approval_forbidden: tr("A cashier cannot approve their own closing.", "لا يمكن لأمين الصندوق اعتماد إغلاق ورديته بنفسه."),
      rejection_note_required: tr("A rejection note is required.", "ملاحظة الرفض مطلوبة."),
      closure_not_pending: tr("This closing is no longer pending approval.", "هذا الإغلاق لم يعد بانتظار الاعتماد."),
      closure_state_changed: tr("The closing changed while reviewing. Refresh and try again.", "تغيرت حالة الإغلاق أثناء المراجعة. حدّث الصفحة وحاول مجددًا."),
    };
    return messages[code] || code || tr("Unable to complete the cashier action.", "تعذر إكمال إجراء أمين الصندوق.");
  }

  async function openShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/billing/cashier-shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: form.get("branchId"),
        currency: form.get("currency"),
        openingCash: form.get("openingCash"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Cashier shift opened.", "تم فتح وردية أمين الصندوق."));
      setOpenModal(false);
      router.refresh();
    } else setMessage(errorText(body.error));
    setBusy(false);
  }

  async function submitClosing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!closing) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/billing/cashier-shifts/${closing.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualCash: form.get("actualCash"), notes: form.get("notes") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${tr("Closing submitted", "تم إرسال الإغلاق")} · ${tr("Expected", "المتوقع")}: ${body.expectedCash} · ${tr("Difference", "الفرق")}: ${body.differenceAmount}`);
      setClosing(null);
      router.refresh();
    } else setMessage(errorText(body.error));
    setBusy(false);
  }

  async function reviewClosing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing?.shift.latestClosure) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/billing/cashier-shifts/closures/${reviewing.shift.latestClosure.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: reviewing.action, note: form.get("note") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(reviewing.action === "APPROVE" ? tr("Closing approved.", "تم اعتماد الإغلاق.") : tr("Closing rejected and shift reopened.", "تم رفض الإغلاق وإعادة فتح الوردية."));
      setReviewing(null);
      router.refresh();
    } else setMessage(errorText(body.error));
    setBusy(false);
  }

  return <div className="admin-grid">
    <div className="admin-page-actions">
      {message && <span className="crud-success-toast">{message}</span>}
      {canManage && <button type="button" className="primary-button" onClick={() => setOpenModal(true)}>{tr("Open Cashier Shift", "فتح وردية أمين صندوق")}</button>}
    </div>

    <CrudModal open={openModal} onClose={() => setOpenModal(false)} title={tr("Open cashier shift", "فتح وردية أمين صندوق")} description={tr("Each active shift is isolated by branch and currency.", "كل وردية نشطة منفصلة حسب الفرع والعملة.")} size="compact">
      <form className="catalog-form" onSubmit={openShift}>
        <label className="form-span">{tr("Branch", "الفرع")}<select name="branchId" required defaultValue={defaultBranch?.id || ""}>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>{tr("Currency", "العملة")}<input name="currency" required minLength={3} maxLength={3} defaultValue={defaultBranch?.defaultCurrency || "EGP"} /></label>
        <label>{tr("Opening cash", "النقد الافتتاحي")}<input name="openingCash" type="number" min="0" step="0.0001" defaultValue="0" required /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Opening…", "جارٍ الفتح…") : tr("Open shift", "فتح الوردية")}</button>
      </form>
    </CrudModal>

    <CrudModal open={Boolean(closing)} onClose={() => setClosing(null)} title={tr("Submit cashier closing", "إرسال إغلاق الوردية")} description={closing ? closing.shiftNumber + " · " + closing.currency : undefined} size="compact">
      {closing && <form className="catalog-form" onSubmit={submitClosing}>
        <div className="form-span form-success">{tr("Opening cash", "النقد الافتتاحي")}: {closing.openingCash} {closing.currency}</div>
        <label>{tr("Actual cash counted", "النقد الفعلي بعد العد")}<input name="actualCash" type="number" min="0" step="0.0001" required /></label>
        <label className="form-span">{tr("Closing notes", "ملاحظات الإغلاق")}<textarea name="notes" maxLength={1000} /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Submitting…", "جارٍ الإرسال…") : tr("Submit for approval", "إرسال للاعتماد")}</button>
      </form>}
    </CrudModal>

    <CrudModal open={Boolean(reviewing)} onClose={() => setReviewing(null)} title={reviewing?.action === "APPROVE" ? tr("Approve cashier closing", "اعتماد إغلاق الوردية") : tr("Reject cashier closing", "رفض إغلاق الوردية")} description={reviewing?.shift.shiftNumber} size="compact">
      {reviewing?.shift.latestClosure && <form className="catalog-form" onSubmit={reviewClosing}>
        <div className="form-span">
          <strong>{tr("Expected cash", "النقد المتوقع")}: {reviewing.shift.latestClosure.expectedCash} {reviewing.shift.currency}</strong><br/>
          <span>{tr("Actual cash", "النقد الفعلي")}: {reviewing.shift.latestClosure.actualCash} {reviewing.shift.currency}</span><br/>
          <span>{tr("Difference", "الفرق")}: {reviewing.shift.latestClosure.differenceAmount} {reviewing.shift.currency}</span>
        </div>
        <label className="form-span">{tr("Review note", "ملاحظة المراجعة")}<textarea name="note" maxLength={1000} required={reviewing.action === "REJECT"} /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : reviewing.action === "APPROVE" ? tr("Approve closing", "اعتماد الإغلاق") : tr("Reject and reopen", "رفض وإعادة الفتح")}</button>
      </form>}
    </CrudModal>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr("Cashier Shifts", "ورديات أمناء الصندوق")}</h2><span>{tr("Payments and refunds are frozen into an immutable closing snapshot before approval.", "تُجمّد الدفعات والاستردادات في لقطة إغلاق ثابتة قبل الاعتماد.")}</span></div><span>{shifts.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Shift", "الوردية")}</th><th>{tr("Cashier", "أمين الصندوق")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Currency", "العملة")}</th><th>{tr("Opening", "الافتتاحي")}</th><th>{tr("Expected", "المتوقع")}</th><th>{tr("Actual", "الفعلي")}</th><th>{tr("Difference", "الفرق")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "الإجراءات")}</th></tr></thead>
        <tbody>{shifts.length === 0 ? <tr><td colSpan={10} className="empty-state">{tr("No cashier shifts yet.", "لا توجد ورديات أمين صندوق بعد.")}</td></tr> : shifts.map(shift => {
          const own = shift.cashierUserId === currentUserId;
          const closure = shift.latestClosure;
          return <tr key={shift.id}>
            <td><strong>{shift.shiftNumber}</strong><small className="table-subtext">{shift.openedAt.slice(0,16).replace("T"," ")}</small></td>
            <td>{shift.cashierName}</td><td>{shift.branchCode} — {shift.branchName}</td><td>{shift.currency}</td><td>{shift.openingCash}</td>
            <td>{closure?.expectedCash || "—"}</td><td>{closure?.actualCash || "—"}</td><td>{closure?.differenceAmount || "—"}</td>
            <td><span className={"status-badge status-" + shift.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, shift.status)}</span></td>
            <td><div className="inline-actions">
              {canManage && own && shift.status === "OPEN" && <button type="button" className="secondary-button compact-action" onClick={() => setClosing(shift)}>{tr("Close", "إغلاق")}</button>}
              {canApprove && !own && shift.status === "PENDING_APPROVAL" && closure?.status === "PENDING" && <>
                <button type="button" className="secondary-button compact-action" onClick={() => setReviewing({ shift, action: "APPROVE" })}>{tr("Approve", "اعتماد")}</button>
                <button type="button" className="secondary-button compact-action" onClick={() => setReviewing({ shift, action: "REJECT" })}>{tr("Reject", "رفض")}</button>
              </>}
              {canApprove && own && shift.status === "PENDING_APPROVAL" && <span className="muted">{tr("Independent approval required", "يتطلب اعتماد مستخدم آخر")}</span>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </div>;
}
