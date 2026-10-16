"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type ServiceOption = { id: string; code: string; name: string };
type BranchOption = { id: string; code: string; name: string };
type RuleRow = {
  id: string; scope: string; service: string; code: string;
  name: string; treatment: string; priceMode: string;
  rate: string; effectiveFrom: string; reason: string;
};

export function TaxRuleManager({
  locale, branches, canOrganizationScope, tests, packages, rules,
}: {
  locale: "ar" | "en"; branches: BranchOption[];
  canOrganizationScope: boolean;
  tests: ServiceOption[]; packages: ServiceOption[];
  rules: RuleRow[];
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [serviceType, setServiceType] = useState<"TEST" | "PACKAGE">("TEST");
  const [treatment, setTreatment] = useState<"STANDARD" | "ZERO_RATED" | "EXEMPT">("STANDARD");
  const [rate, setRate] = useState("0.00");

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/billing/tax-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: form.get("branchId"),
          serviceType,
          serviceId: form.get("serviceId"),
          code: form.get("code"),
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          treatment,
          priceMode: form.get("priceMode"),
          ratePercent: rate,
          effectiveFrom: form.get("effectiveFrom"),
          reason: form.get("reason"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        setMessage(tr("Tax revision published. Previous rules and issued invoices remain unchanged.", "تم نشر نسخة القاعدة الضريبية. بقيت القواعد القديمة والفواتير الصادرة دون تغيير."));
        setOpen(false);
        router.refresh();
      } else {
        const errors: Record<string, string> = {
          invalid_tax_fields: tr("Complete all fields with valid tax values.", "أكمل الحقول الضريبية بقيم صحيحة."),
          invalid_tax_treatment_rate: tr("Standard tax must have a positive rate; exempt/zero-rated must have zero rate.", "الضريبة العادية تتطلب نسبة موجبة، والمعفى أو صفر بالمئة يتطلب نسبة صفر."),
          tax_rule_revision_exists: tr("A revision already exists for this service, scope and effective date.", "توجد نسخة لهذه الخدمة والنطاق وتاريخ السريان."),
          organization_scope_incomplete: tr("Organization rules require access to every active branch.", "قاعدة المؤسسة تتطلب صلاحية الوصول إلى كل الفروع النشطة."),
          tax_service_not_found: tr("Service is unavailable.", "الخدمة غير متاحة."),
        };
        setMessage(errors[result.error] || tr("Could not publish tax rule.", "تعذر نشر القاعدة الضريبية."));
      }
    } catch {
      setMessage(tr("Connection error while publishing tax rule.", "خطأ في الاتصال أثناء نشر القاعدة."));
    }
    setBusy(false);
  }

  return <div className="admin-grid">
    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr("Tax Configuration", "إعدادات الضرائب")}</h2>
          <span>{tr("Only explicitly published tax rules apply. Existing invoices remain unchanged.", "تُطبق القواعد المنشورة صراحة فقط. تبقى الفواتير السابقة دون تغيير.")}</span>
        </div>
        <button type="button" className="primary-button" disabled={busy}
          onClick={() => { setMessage(""); setOpen(true); }}>
          {tr("Publish Tax Rule", "نشر قاعدة ضريبية")}
        </button>
      </div>
      {!open && message && <p className="form-success" role="status">{message}</p>}
      <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
        size="compact"
        title={tr("Publish New Tax Rule", "نشر قاعدة ضريبية جديدة")}
        description={tr(
          "Review scope, service, tax treatment, exact rate and effective date before publication. Previous issued invoices remain unchanged.",
          "راجع النطاق والخدمة والمعاملة والنسبة وتاريخ السريان قبل النشر. تبقى الفواتير الصادرة دون تغيير.",
        )}>
      {open && <form className="catalog-form" onSubmit={publish}>
        <label>{tr("Scope", "النطاق")}
          <select name="branchId" defaultValue={branches[0]?.id || ""} required={!canOrganizationScope}>
            {canOrganizationScope && <option value="">{tr("Organization default", "الافتراضي للمؤسسة")}</option>}
            {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
          </select>
        </label>
        <label>{tr("Service type", "نوع الخدمة")}
          <select value={serviceType} onChange={event => setServiceType(event.target.value as "TEST" | "PACKAGE")}>
            <option value="TEST">{tr("Laboratory test", "فحص مخبري")}</option>
            <option value="PACKAGE">{tr("Commercial package", "باقة تجارية")}</option>
          </select>
        </label>
        <label className="form-span">{tr("Service", "الخدمة")}
          <select name="serviceId" required key={serviceType} defaultValue="">
            <option value="">{tr("Select service…", "اختر الخدمة…")}</option>
            {(serviceType === "TEST" ? tests : packages).map(service =>
              <option key={service.id} value={service.id}>{service.code} — {service.name}</option>)}
          </select>
        </label>
        <label>{tr("Tax code", "رمز الضريبة")}<input name="code" required maxLength={60} placeholder="TAX_STANDARD" pattern="[A-Za-z0-9_-]{2,60}" /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required maxLength={200} /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" maxLength={200} /></label>
        <label>{tr("Treatment", "المعاملة الضريبية")}
          <select value={treatment} onChange={event => { const next = event.target.value as "STANDARD" | "ZERO_RATED" | "EXEMPT"; setTreatment(next); if (next !== "STANDARD") setRate("0.00"); }}>
            <option value="STANDARD">{tr("Standard taxed", "خاضع للضريبة")}</option>
            <option value="ZERO_RATED">{tr("Zero-rated", "صفر بالمئة")}</option>
            <option value="EXEMPT">{tr("Exempt", "معفى")}</option>
          </select>
        </label>
        <label>{tr("Price tax mode", "طريقة احتساب السعر")}
          <select name="priceMode" defaultValue="EXCLUSIVE">
            <option value="EXCLUSIVE">{tr("Price excludes tax", "السعر لا يشمل الضريبة")}</option>
            <option value="INCLUSIVE">{tr("Price includes tax", "السعر يشمل الضريبة")}</option>
          </select>
        </label>
        <label>{tr("Rate (%)", "النسبة (%)")}<input type="number" min="0" max="100" step="0.01" required disabled={treatment !== "STANDARD"} value={rate} onChange={event => setRate(event.target.value)} /></label>
        <label>{tr("Effective date", "تاريخ السريان")}<input name="effectiveFrom" type="date" required /></label>
        <label className="form-span">{tr("Publication reason", "سبب نشر القاعدة")}<textarea name="reason" maxLength={1000} required /></label>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Publishing…", "جارٍ النشر…") : tr("Publish New Tax Rule", "نشر قاعدة ضريبية جديدة")}</button>
        {message && <div className="form-error form-span" role="alert">{message}</div>}
      </form>}
      </CrudModal>
    </section>

    <section className="table-card">
      <div className="table-toolbar"><div>
        <h2>{tr("Rule Revision History", "سجل إصدارات القواعد")}</h2>
        <span>{rules.length} {tr("immutable revisions", "نسخة غير قابلة للتعديل")}</span>
      </div></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Scope", "النطاق")}</th><th>{tr("Service", "الخدمة")}</th>
          <th>{tr("Code", "الرمز")}</th><th>{tr("Treatment", "المعاملة")}</th>
          <th>{tr("Rate", "النسبة")}</th><th>{tr("Price mode", "وضع السعر")}</th>
          <th>{tr("Effective from", "يسري من")}</th><th>{tr("Reason", "السبب")}</th>
        </tr></thead>
        <tbody>{rules.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr("No tax rules yet. Orders remain tax-free until a matching rule is published.", "لا توجد قواعد بعد. تبقى الطلبات دون ضريبة لحين نشر قاعدة مطابقة.")}</td></tr>
          : rules.map(rule => <tr key={rule.id}>
            <td>{rule.scope}</td><td>{rule.service}</td>
            <td><strong>{rule.code}</strong><small className="table-subtext">{rule.name}</small></td>
            <td>{rule.treatment}</td><td>{rule.rate}%</td><td>{rule.priceMode}</td>
            <td>{rule.effectiveFrom}</td><td>{rule.reason}</td>
          </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
