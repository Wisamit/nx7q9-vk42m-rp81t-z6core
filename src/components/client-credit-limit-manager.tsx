"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type CreditClientOption = { id: string; code: string; name: string };
type CreditPolicyRow = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: string;
  mode: "DISABLED" | "WARN" | "BLOCK";
  limitAmount: string;
  exposure: string;
  remaining: string;
  utilizationExceeded: boolean;
  updatedAt: string;
  reason: string | null;
};

export function ClientCreditLimitManager({
  locale,
  clients,
  policies,
}: {
  locale: "ar" | "en";
  clients: CreditClientOption[];
  policies: CreditPolicyRow[];
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [currency, setCurrency] = useState("");
  const [mode, setMode] = useState<"DISABLED" | "WARN" | "BLOCK">("DISABLED");
  const [limitAmount, setLimitAmount] = useState("0.0000");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState("");

  function edit(policy: CreditPolicyRow) {
    setClientId(policy.clientId);
    setCurrency(policy.currency);
    setMode(policy.mode);
    setLimitAmount(policy.limitAmount);
    setReason("");
    setFormError("");
    setMessage("");
    setOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/billing/credit-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, currency, mode, limitAmount, reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setMessage(tr("Credit policy saved and audited.", "تم حفظ سياسة الائتمان وتسجيلها في سجل التدقيق."));
        setReason("");
        setOpen(false);
        router.refresh();
      } else {
        const errors: Record<string, string> = {
          organization_scope_incomplete: tr("Managing organization credit limits requires access to every active branch.", "إدارة حدود ائتمان المؤسسة تتطلب صلاحية الوصول لجميع الفروع النشطة."),
          client_credit_state_changed: tr("The client credit state changed. Refresh and try again.", "تغيرت حالة ائتمان العميل. حدّث الصفحة وحاول مجددًا."),
          invalid_credit_policy_fields: tr("Enter a client, currency, valid non-negative limit and change reason.", "اختر العميل والعملة وحدًا غير سالب وسببًا للتغيير."),
        };
        setFormError(errors[body.error] || tr("Could not save the credit policy.", "تعذر حفظ سياسة الائتمان."));
      }
    } catch {
      setFormError(tr("Connection failed while saving the policy.", "فشل الاتصال أثناء حفظ سياسة الائتمان."));
    }
    setBusy(false);
  }

  return <div className="admin-grid">
    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr("Configure Client Credit", "إعداد ائتمان العميل")}</h2>
          <span>{tr("One policy per client and currency across all branches. Clients without a policy remain unrestricted.", "سياسة لكل عميل وعملة تشمل كل الفروع. العملاء دون سياسة لا تُفرض عليهم حدود تلقائيًا.")}</span>
        </div>
        <button type="button" className="primary-button" disabled={busy}
          onClick={() => { setFormError(""); setMessage(""); setOpen(true); }}>
          {tr("Configure Client Credit", "إعداد ائتمان العميل")}
        </button>
      </div>
      <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
        size="compact"
        title={tr("Configure Client Credit", "إعداد ائتمان العميل")}
        description={tr(
          "Financial credit limits are organization-wide per client and currency. Review the limit, mode and reason.",
          "حدود الائتمان على مستوى المؤسسة لكل عميل وعملة. راجع الحد والنمط والسبب قبل الحفظ.",
        )}>
        {open && <form className="catalog-form" onSubmit={save}>
        <label className="form-span">{tr("Client", "العميل")}
          <select required value={clientId} onChange={event => setClientId(event.target.value)}>
            <option value="">{tr("Select client…", "اختر العميل…")}</option>
            {clients.map(client => <option value={client.id} key={client.id}>{client.code} — {client.name}</option>)}
          </select>
        </label>
        <label>{tr("Currency", "العملة")}<input required value={currency} maxLength={3} placeholder="EGP" onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
        <label>{tr("Policy", "السياسة")}
          <select value={mode} onChange={event => setMode(event.target.value as "DISABLED" | "WARN" | "BLOCK")}>
            <option value="DISABLED">{tr("Disabled — no limit enforcement", "معطلة — لا يُفرض حد")}</option>
            <option value="WARN">{tr("Warn — record over-limit orders", "تحذير — توثيق الطلبات المتجاوزة")}</option>
            <option value="BLOCK">{tr("Block — reject over-limit orders", "منع — رفض الطلبات التي تتجاوز الحد")}</option>
          </select>
        </label>
        <label>{tr("Credit limit", "الحد الائتماني")}<input type="number" required min="0" step="0.0001" value={limitAmount} onChange={event => setLimitAmount(event.target.value)} /></label>
        <label className="form-span">{tr("Reason for change", "سبب التغيير")}<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="submit" className="primary-button form-span" disabled={busy || !clientId}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Credit Policy", "حفظ سياسة الائتمان")}</button>
        {message && <div className="form-success form-span">{message}</div>}
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
      </form>}
      </CrudModal>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar">
        <div><h2>{tr("Configured Credit Policies", "سياسات الائتمان المهيأة")}</h2><span>{policies.length} {tr("policies", "سياسة")} · {tr("Outstanding is organization-wide, including all branches.", "الرصيد القائم يشمل جميع فروع المؤسسة.")}</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Client", "العميل")}</th><th>{tr("Currency", "العملة")}</th><th>{tr("Mode", "الوضع")}</th>
          <th>{tr("Limit", "الحد")}</th><th>{tr("Outstanding", "القائم")}</th><th>{tr("Headroom", "المتاح")}</th>
          <th>{tr("Updated", "آخر تعديل")}</th><th>{tr("Actions", "الإجراءات")}</th>
        </tr></thead>
        <tbody>{policies.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr("No policies configured yet.", "لم تُهيأ أي سياسة بعد.")}</td></tr> : policies.map(policy => <tr key={policy.id}>
          <td><strong>{policy.clientCode}</strong><small className="table-subtext">{policy.clientName}</small></td>
          <td>{policy.currency}</td>
          <td>{policy.mode === "BLOCK" ? tr("Block", "منع") : policy.mode === "WARN" ? tr("Warn", "تحذير") : tr("Disabled", "معطل")}</td>
          <td>{policy.limitAmount}</td><td>{policy.exposure}</td>
          <td><strong>{policy.remaining}</strong>{policy.utilizationExceeded && <small className="table-subtext">{tr("Limit exceeded", "الحد متجاوز")}</small>}</td>
          <td><SystemDateText value={policy.updatedAt} /></td>
          <td><button type="button" className="secondary-button compact-action" onClick={() => edit(policy)}>{tr("Edit", "تعديل")}</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
