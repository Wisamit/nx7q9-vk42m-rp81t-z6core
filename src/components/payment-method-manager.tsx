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

  async function createMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
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
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Payment method created.", "تم إنشاء طريقة الدفع."));
      setOpen(false);
      event.currentTarget.reset();
      router.refresh();
    } else if (body.error === "payment_method_code_exists") {
      setMessage(tr("This payment method code already exists.", "رمز طريقة الدفع مستخدم مسبقًا."));
    } else setMessage(body.error || tr("Could not create payment method.", "تعذر إنشاء طريقة الدفع."));
    setBusy(false);
  }

  async function changeStatus(method: MethodRow) {
    const reason = window.prompt(
      method.status === "ACTIVE"
        ? tr("Reason for deactivating this payment method:", "سبب إيقاف طريقة الدفع:")
        : tr("Reason for activating this payment method:", "سبب تفعيل طريقة الدفع:"),
    );
    if (!reason?.trim()) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/billing/payment-methods/" + method.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: method.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
        reason,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(method.status === "ACTIVE"
        ? tr("Payment method deactivated. Historical transactions are unchanged.", "تم إيقاف طريقة الدفع دون تغيير الحركات التاريخية.")
        : tr("Payment method activated.", "تم تفعيل طريقة الدفع."));
      router.refresh();
    } else setMessage(body.error || tr("Could not change payment method status.", "تعذر تغيير حالة طريقة الدفع."));
    setBusy(false);
  }

  return <>
    <div className="crud-action-bar">
      <div>{message && <span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button className="primary-button" type="button" onClick={() => { setMessage(""); setOpen(true); }}>
          {tr("New Payment Method", "طريقة دفع جديدة")}
        </button>
      </div>
    </div>

    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("Create Payment Method", "إنشاء طريقة دفع")}
      description={tr(
        "Map the operational payment name to a stable accounting base method. Historical transactions keep name/code snapshots.",
        "اربط اسم طريقة الدفع التشغيلية بطريقة محاسبية أساسية ثابتة. تحتفظ الحركات التاريخية بلقطة الاسم والرمز.",
      )}
      size="md"
    >
      <form className="catalog-form" onSubmit={createMethod}>
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
      </form>
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
            ? <button className="secondary-button" type="button" disabled={busy} onClick={() => changeStatus(method)}>
                {method.status === "ACTIVE" ? tr("Deactivate", "إيقاف") : tr("Activate", "تفعيل")}
              </button>
            : <span className="muted">{tr("System account method", "طريقة حساب نظامية")}</span>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
