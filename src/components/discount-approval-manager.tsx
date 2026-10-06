"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApprovalRow = {
  id: string;
  branchCode: string;
  branchName: string;
  requesterName: string;
  discountPercent: string;
  reason: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
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
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function decide(id: string, action: "APPROVE" | "REJECT") {
    const row = approvals.find(item => item.id === id);
    if (!row) return;

    let note = "";
    if (action === "APPROVE") {
      const confirmed = confirm(tr(
        `Approve ${row.discountPercent}% discount for ${row.finalTotal} ${row.currency}?`,
        `اعتماد خصم ${row.discountPercent}% ليصبح الإجمالي ${row.finalTotal} ${row.currency}؟`,
      ));
      if (!confirmed) return;
    } else {
      const entered = prompt(tr("Optional rejection note:", "ملاحظة الرفض (اختيارية):"));
      if (entered === null) return;
      note = entered;
    }

    setBusyId(id);
    setMessage("");
    const response = await fetch("/api/billing/discount-approvals/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(action === "APPROVE"
        ? tr("Discount approval recorded.", "تم تسجيل اعتماد الخصم.")
        : tr("Discount request rejected.", "تم رفض طلب الخصم."));
      router.refresh();
    } else if (body.error === "discount_limit_exceeded") {
      setMessage(tr(
        `Your discount approval limit is ${body.approverLimitPercent}%.`,
        `حد اعتماد الخصم لديك هو ${body.approverLimitPercent}%.`,
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
    setBusyId("");
  }

  return <section className="table-card detail-section">
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
          <th>{tr("Discount", "الخصم")}</th>
          <th>{tr("Financial impact", "الأثر المالي")}</th>
          <th>{tr("Reason", "السبب")}</th>
          <th>{tr("Expires", "تنتهي")}</th>
          <th>{tr("Actions", "الإجراءات")}</th>
        </tr></thead>
        <tbody>
          {approvals.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No pending discount approvals.", "لا توجد طلبات خصم معلقة.")}</td></tr> :
            approvals.map(row => {
              const withinLimit = Number(row.discountPercent) <= approverLimitPercent;
              return <tr key={row.id}>
                <td>{row.requestedAt.slice(0,16).replace("T"," ")}</td>
                <td><strong>{row.branchCode}</strong><br/><small>{row.branchName} · {row.requesterName}</small></td>
                <td><strong>{row.discountPercent}%</strong><br/><small>{row.discountTotal} {row.currency}</small></td>
                <td>{row.subtotal} → <strong>{row.finalTotal}</strong> {row.currency}</td>
                <td>{row.reason}</td>
                <td>{row.expiresAt.slice(0,16).replace("T"," ")}</td>
                <td><div className="inline-actions">
                  <button type="button" className="primary-button compact-action" disabled={busyId === row.id || !withinLimit} onClick={() => void decide(row.id, "APPROVE")}>{tr("Approve", "اعتماد")}</button>
                  <button type="button" className="secondary-button compact-action" disabled={busyId === row.id} onClick={() => void decide(row.id, "REJECT")}>{tr("Reject", "رفض")}</button>
                </div>{!withinLimit && <small className="table-subtext">{tr("Above your approval limit", "أعلى من حد اعتمادك")}</small>}</td>
              </tr>;
            })
          }
        </tbody>
      </table>
    </div>
  </section>;
}
