"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {StaffStepUpDialog} from "@/components/staff-step-up-dialog";
import {CrudModal} from "@/components/crud-modal";

type ApprovalRow = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  requesterName: string;
  patientNumber: string;
  services: string;
  discountPercent: string;
  reason: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  finalTotal: string;
  requestedAt: string;
  expiresAt: string;
};

export function DiscountApprovalManager({
  approvals,
  approverLimitPercent,
  locale,
}: {
  approvals: ApprovalRow[];
  approverLimitPercent: number;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [pendingStepUpId,setPendingStepUpId]=useState<string|null>(null);
  const [decision,setDecision]=useState<{id:string;action:"APPROVE"|"REJECT"}|null>(null);
  const [rejectionNote,setRejectionNote]=useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function decide(id: string, action: "APPROVE" | "REJECT", token?: string, note = "") {
    const row = approvals.find(item => item.id === id);
    if (!row || busyId) return;
    if (action === "APPROVE" && !token) {
      // Approval is never sent without a fresh, action-bound staff step-up.
      setPendingStepUpId(id);
      return;
    }

    setBusyId(id);
    setMessage("");
    try {
      const response = await fetch("/api/billing/discount-approvals/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json",
          ...(token ? { "x-staff-step-up-token": token } : {}) },
        body: JSON.stringify({ action, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setDecision(null);
        setMessage(action === "APPROVE"
          ? tr("Discount approval recorded.", "تم تسجيل اعتماد الخصم.")
          : tr("Discount request rejected.", "تم رفض طلب الخصم."));
        router.refresh();
      } else if (body.error === "discount_limit_exceeded") {
        setMessage(tr(
          "Your discount approval limit is " + body.approverLimitPercent + "%.",
          "حد اعتماد الخصم لديك هو " + body.approverLimitPercent + "%.",
        ));
      } else if (body.error === "approval_expired") {
        setMessage(tr("This approval request has expired.", "انتهت صلاحية طلب الاعتماد."));
        router.refresh();
      } else if (body.error === "approval_not_pending" || body.error === "approval_state_changed") {
        setMessage(tr("This request was already decided or changed.", "تم اتخاذ قرار بهذا الطلب أو تغيرت حالته."));
        router.refresh();
      } else {
        setMessage(tr("Could not update the discount approval.", "تعذر تحديث اعتماد الخصم."));
      }
    } catch {
      setMessage(tr("Connection error; approval state must be checked before retry.",
        "خطأ في الاتصال؛ يجب التحقق من حالة الاعتماد قبل إعادة المحاولة."));
    } finally {
      setBusyId("");
    }
  }

  function openDecision(id: string, action: "APPROVE" | "REJECT") {
    if (busyId) return;
    setMessage("");
    setRejectionNote("");
    setDecision({id, action});
  }

  async function confirmDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || busyId) return;
    const row = approvals.find(item => item.id === decision.id);
    if (!row) {
      setMessage(tr("Request state changed; refresh the queue.", "تغيّرت حالة الطلب؛ حدّث قائمة الانتظار."));
      return;
    }
    const id = decision.id;
    if (decision.action === "APPROVE") {
      // Financial approval continues in the separate staff step-up dialog.
      setDecision(null);
      setPendingStepUpId(id);
    } else {
      await decide(id, "REJECT", undefined, rejectionNote.trim());
    }
  }

  const pendingStepUpRow=approvals.find(item=>item.id===pendingStepUpId);
  return <section className="table-card detail-section">
    <StaffStepUpDialog open={Boolean(pendingStepUpRow)} action="DISCOUNT_APPROVAL"
      resourceKey={pendingStepUpRow?.id||""} branchId={pendingStepUpRow?.branchId||""}
      locale={locale} onCancel={()=>setPendingStepUpId(null)}
      onGranted={token=>{
        const id=pendingStepUpId;setPendingStepUpId(null);
        if(id)void decide(id,"APPROVE",token);
      }}/>
    <div className="table-toolbar">
      <div>
        <h2>{tr("Discount Approval Queue", "قائمة اعتماد الخصومات")}</h2>
        <span>{tr("Your approval limit", "حد الاعتماد لديك")}: {approverLimitPercent.toFixed(2)}%</span>
      </div>
      <span>{approvals.length}</span>
    </div>
    {message && <div className="form-success">{message}</div>}
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th>{tr("Requested", "تاريخ الطلب")}</th>
          <th>{tr("Branch / Requester", "الفرع / مقدم الطلب")}</th>
          <th>{tr("Patient / Services", "المريض / الخدمات")}</th>
          <th>{tr("Discount", "الخصم")}</th>
          <th>{tr("Financial impact", "الأثر المالي")}</th>
          <th>{tr("Reason", "السبب")}</th>
          <th>{tr("Expires", "تنتهي")}</th>
          <th>{tr("Actions", "الإجراءات")}</th>
        </tr></thead>
        <tbody>
          {approvals.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr("No pending discount approvals.", "لا توجد طلبات خصم معلقة.")}</td></tr> :
            approvals.map(row => {
              const withinLimit = Number(row.discountPercent) <= approverLimitPercent;
              return <tr key={row.id}>
                <td>{row.requestedAt.slice(0,16).replace("T"," ")}</td>
                <td><strong>{row.branchCode}</strong><br/><small>{row.branchName} · {row.requesterName}</small></td>
                <td><strong>{row.patientNumber}</strong><br/><small>{row.services}</small></td>
                <td><strong>{row.discountPercent}%</strong><br/><small>{row.discountTotal} {row.currency}</small></td>
                <td>{row.subtotal} − {row.discountTotal} + {tr("Tax", "الضريبة")} {row.taxTotal} → <strong>{row.finalTotal}</strong> {row.currency}</td>
                <td>{row.reason}</td>
                <td>{row.expiresAt.slice(0,16).replace("T"," ")}</td>
                <td><div className="inline-actions">
                  <button type="button" className="primary-button compact-action" disabled={busyId === row.id || !withinLimit} onClick={() => openDecision(row.id, "APPROVE")}>{tr("Approve", "اعتماد")}</button>
                  <button type="button" className="secondary-button compact-action" disabled={busyId === row.id} onClick={() => openDecision(row.id, "REJECT")}>{tr("Reject", "رفض")}</button>
                </div>{!withinLimit && <small className="table-subtext">{tr("Above your approval limit", "أعلى من حد اعتمادك")}</small>}</td>
              </tr>;
            })
          }
        </tbody>
      </table>
    </div>
    <CrudModal open={decision !== null} onClose={() => {if (!busyId) setDecision(null);}}
      size="compact"
      title={decision?.action === "APPROVE"
        ? tr("Review Discount Approval", "مراجعة اعتماد الخصم")
        : tr("Reject Discount Request", "رفض طلب الخصم")}
      description={tr(
        "Financial approval requires a separate, one-time staff step-up. Rejection preserves the signed request history.",
        "يتطلب الاعتماد المالي تحقق موظف إضافياً لمرة واحدة. ويحافظ الرفض على تاريخ الطلب.",
      )}>
      {decision && <form className="catalog-form" onSubmit={confirmDecision}>
        {(() => {
          const row = approvals.find(item => item.id === decision.id);
          if (!row) return <p className="form-error form-span" role="alert">{tr("Request unavailable.", "الطلب غير متاح.")}</p>;
          return <div className="form-span">
            <strong>{row.branchCode} · {row.patientNumber}</strong>
            <p>{row.services}</p>
            <p>{tr("Discount", "الخصم")}: {row.discountPercent}% ·
              {tr("Final total", "الإجمالي النهائي")}: {row.finalTotal} {row.currency}</p>
            <p>{tr("Original reason", "السبب الأصلي")}: {row.reason}</p>
          </div>;
        })()}
        {decision.action === "REJECT" && <label className="form-span">
          {tr("Optional rejection note", "ملاحظة الرفض (اختيارية)")}
          <textarea rows={3} maxLength={1000} value={rejectionNote}
            onChange={event => setRejectionNote(event.target.value)} />
        </label>}
        {message && <p className="form-warning form-span" role="status">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busyId)}>
          {decision.action === "APPROVE"
            ? tr("Proceed to staff verification", "المتابعة إلى تحقق الموظف")
            : tr("Confirm rejection", "تأكيد الرفض")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
