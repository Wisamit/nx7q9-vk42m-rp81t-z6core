"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type MethodRow = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  baseMethod: string;
  requiresReference: boolean;
  sortOrder: number;
  status: string;
  isSettlement: boolean;
};

export function PaymentMethodManager({ methods, locale }: { methods: MethodRow[]; locale: "ar" | "en" }) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [statusTarget, setStatusTarget] = useState<MethodRow | null>(null);
  const [statusReason, setStatusReason] = useState("");

  async function createMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setFormError("");
    try {
      const response = await fetch("/api/billing/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          baseMethod: form.get("baseMethod"),
          requiresReference: form.get("requiresReference") === "on",
          sortOrder: Number(form.get("sortOrder") || 0),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error === "payment_method_code_exists"
          ? tr("This payment method code already exists.", "رمز طريقة الدفع مستخدم مسبقًا.")
          : body.error || tr("Could not create payment method.", "تعذر إنشاء طريقة الدفع."));
        return;
      }
      setMessage(tr("Payment method created.", "تم إنشاء طريقة الدفع."));
      setOpen(false);
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted. Check the payment method list before retrying.",
        "انقطع الاتصال؛ راجع قائمة طرق الدفع قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  function openStatusReview(method: MethodRow) {
    if (busy || !method.isSettlement) return;
    setStatusTarget(method);
    setStatusReason("");
    setFormError("");
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusTarget || busy || !statusTarget.isSettlement) return;
    const reason = statusReason.trim();
    if (!reason) {
      setFormError(tr("A documented status-change reason is required.", "سبب تغيير الحالة الموثق إلزامي."));
      return;
    }
    setBusy(true); setFormError("");
    try {
      const response = await fetch("/api/billing/payment-methods/" + statusTarget.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
          reason,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not change payment method status.", "تعذر تغيير حالة طريقة الدفع."));
        return;
      }
      setMessage(statusTarget.status === "ACTIVE"
        ? tr("Payment method deactivated. Historical transactions are unchanged.", "تم إيقاف طريقة الدفع دون تغيير الحركات التاريخية.")
        : tr("Payment method activated.", "تم تفعيل طريقة الدفع."));
      setStatusTarget(null);
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted. Verify payment method state before retrying.",
        "انقطع الاتصال؛ تحقق من حالة طريقة الدفع قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="crud-action-bar">
      <div>{message && <span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button className="primary-button" type="button" disabled={busy} onClick={() => { setFormError(""); setMessage(""); setOpen(true); }}>
          {tr("New Payment Method", "طريقة دفع جديدة")}
        </button>
      </div>
    </div>

    <CrudModal
      open={open}
      onClose={() => { if (!busy) setOpen(false); }}
      title={tr("Create Payment Method", "إنشاء طريقة دفع")}
      description={tr(
        "Map the operational payment name to a stable accounting base method. Historical transactions keep name/code snapshots.",
        "اربط اسم طريقة الدفع التشغيلية بطريقة محاسبية أساسية ثابتة. تحتفظ الحركات التاريخية بلقطة الاسم والرمز.",
      )}
      size="compact"
    >
      {open && <form className="catalog-form" onSubmit={createMethod}>
        <label>{tr("Code", "الرمز")}<input name="code" maxLength={60} required placeholder={tr("e.g. VISA_POS_1", "مثال VISA_POS_1")} /></label>
        <label>{tr("Base method", "الطريقة الأساسية")}<select name="baseMethod" required defaultValue="CARD">
          <option value="CASH">{tr("Cash", "نقدي")}</option>
          <option value="CARD">{tr("Card", "بطاقة")}</option>
          <option value="BANK_TRANSFER">{tr("Bank transfer", "تحويل بنكي")}</option>
          <option value="ONLINE">{tr("Online", "إلكتروني")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={160} required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" maxLength={160} dir="rtl" /></label>
        <label>{tr("Sort order", "ترتيب العرض")}<input name="sortOrder" type="number" defaultValue="100" /></label>
        <label className="checkbox-line"><input name="requiresReference" type="checkbox" />{tr("Require transaction/reference number", "يتطلب رقم مرجع أو عملية")}</label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Method", "إنشاء الطريقة")}</button>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
      </form>}
    </CrudModal>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr("Payment Methods", "طرق الدفع")}</h2><span>{tr("Deactivation never rewrites historical payment/refund snapshots.", "إيقاف الطريقة لا يغيّر لقطات الدفعات أو الاستردادات التاريخية.")}</span></div><span>{methods.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Code", "الرمز")}</th><th>{tr("Name", "الاسم")}</th><th>{tr("Accounting base", "الأساس المحاسبي")}</th>
          <th>{tr("Reference", "المرجع")}</th><th>{tr("Order", "الترتيب")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Action", "الإجراء")}</th>
        </tr></thead>
        <tbody>{methods.map(method => <tr key={method.id}>
          <td><strong>{method.code}</strong></td>
          <td>{locale === "ar" ? method.nameAr || method.nameEn : method.nameEn}</td>
          <td>{method.baseMethod}</td>
          <td>{method.requiresReference ? tr("Required", "مطلوب") : tr("Optional", "اختياري")}</td>
          <td>{method.sortOrder}</td>
          <td><span className={"status-badge status-" + method.status.toLowerCase()}>{statusLabel(locale, method.status)}</span></td>
          <td>{method.isSettlement
            ? <button className="secondary-button" type="button" disabled={busy} onClick={() => openStatusReview(method)}>
                {method.status === "ACTIVE" ? tr("Deactivate", "إيقاف") : tr("Activate", "تفعيل")}
              </button>
            : <span className="muted">{tr("System account method", "طريقة حساب نظامية")}</span>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <CrudModal open={statusTarget !== null} onClose={() => { if (!busy) setStatusTarget(null); }}
      size="compact"
      title={tr("Review Payment Method Status", "مراجعة حالة طريقة الدفع")}
      description={tr(
        "Payment methods are financial configuration. Updating status never changes historical payment or refund snapshots.",
        "طرق الدفع من الإعدادات المالية. تغيير الحالة لا يغيّر لقطات الدفعات أو الاستردادات السابقة.",
      )}>
      {statusTarget && <form className="catalog-form" onSubmit={changeStatus}>
        <div className="form-span">
          <strong>{statusTarget.code}</strong>
          <p>{locale === "ar" ? statusTarget.nameAr || statusTarget.nameEn : statusTarget.nameEn}</p>
          <p>{tr("New status", "الحالة الجديدة")}:{" "}
            {statusTarget.status === "ACTIVE" ? tr("Inactive", "غير نشط") : tr("Active", "نشط")}</p>
        </div>
        <label className="form-span">
          {tr("Documented reason (required)", "السبب الموثق (مطلوب)")}
          <textarea rows={3} required maxLength={1000}
            value={statusReason} onChange={event => setStatusReason(event.target.value)} />
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" type="submit"
          disabled={busy || !statusReason.trim()}>
          {tr("Confirm status change", "تأكيد تغيير الحالة")}
        </button>
      </form>}
    </CrudModal>
  </>;
}
