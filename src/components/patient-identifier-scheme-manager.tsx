"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Scheme = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  identifierType: "NATIONAL_ID" | "PASSPORT" | "OTHER";
  requiresIssuingCountry: boolean;
  status: "ACTIVE" | "INACTIVE";
};

export function PatientIdentifierSchemeManager({
  schemes,
  locale,
}: {
  schemes: Scheme[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivationId, setDeactivationId] = useState<string | null>(null);
  const deactivation = schemes.find(item => item.id === deactivationId) ?? null;

  function openCreate() {
    setMessage("");
    setFormError("");
    setCreateOpen(true);
  }

  function openDeactivation(scheme: Scheme) {
    setMessage("");
    setFormError("");
    setDeactivationId(scheme.id);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setFormError("");
    try {
      const response = await fetch("/api/patients/identifier-schemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          requiresIssuingCountry: form.get("requiresIssuingCountry") === "on",
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        setCreateOpen(false);
        setMessage(tr("Identifier scheme created.", "تم إنشاء نوع المعرّف."));
        router.refresh();
      } else {
        setFormError(body.error || tr("Could not create identifier scheme.", "تعذر إنشاء نوع المعرّف."));
      }
    } catch {
      setFormError(tr("Connection error while creating identifier scheme.", "حدث خطأ في الاتصال أثناء إنشاء نوع المعرّف."));
    } finally {
      setBusy("");
    }
  }

  async function deactivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deactivation || busy) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "").trim();
    if (!reason) {
      setFormError(tr("A reason is required.", "السبب مطلوب."));
      return;
    }
    setBusy(deactivation.id);
    setFormError("");
    try {
      const response = await fetch("/api/patients/identifier-schemes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deactivation.id, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        setDeactivationId(null);
        setMessage(tr("Identifier scheme deactivated.", "تم تعطيل نوع المعرّف."));
        router.refresh();
      } else {
        setFormError(body.error || tr("Could not deactivate identifier scheme.", "تعذر تعطيل نوع المعرّف."));
      }
    } catch {
      setFormError(tr("Connection error while deactivating identifier scheme.", "حدث خطأ في الاتصال أثناء تعطيل نوع المعرّف."));
    } finally {
      setBusy("");
    }
  }

  return <>
    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr("Identifier Schemes", "أنواع معرّفات المرضى")}</h2>
          <span>{tr("Standard schemes stay available; custom schemes are soft-deactivated.", "تبقى الأنواع القياسية متاحة، ويتم تعطيل الأنواع المخصصة دون حذفها.")}</span>
        </div>
        <button type="button" className="primary-button" onClick={openCreate} disabled={Boolean(busy)}>
          {tr("Add Custom Scheme", "إضافة نوع مخصص")}
        </button>
      </div>
      {message && <p className="form-success" role="status">{message}</p>}
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Code", "الرمز")}</th>
          <th>{tr("Name", "الاسم")}</th>
          <th>{tr("Base type", "النوع الأساسي")}</th>
          <th>{tr("Issuing country", "بلد الإصدار")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th>{tr("Action", "الإجراء")}</th>
        </tr></thead>
        <tbody>{schemes.map(scheme => <tr key={scheme.id}>
          <td><strong>{scheme.code}</strong></td>
          <td>{locale === "ar" ? scheme.nameAr || scheme.nameEn : scheme.nameEn}</td>
          <td>{scheme.identifierType}</td>
          <td>{scheme.requiresIssuingCountry ? tr("Required", "مطلوب") : tr("Optional", "اختياري")}</td>
          <td>{scheme.status}</td>
          <td>{scheme.identifierType === "OTHER" && scheme.code !== "LEGACY_OTHER" && scheme.status === "ACTIVE"
            ? <button type="button" className="secondary-button" disabled={Boolean(busy)}
                onClick={() => openDeactivation(scheme)}>
                {tr("Deactivate", "تعطيل")}
              </button>
            : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <CrudModal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} size="compact"
      title={tr("Add Custom Identifier Scheme", "إضافة نوع معرّف مخصص")}
      description={tr(
        "Add an organization-wide identifier scheme without changing historical patient identifiers.",
        "أضف نوع معرّف على مستوى المؤسسة دون تغيير المعرّفات التاريخية للمرضى.",
      )}>
      {createOpen && <form className="catalog-form" onSubmit={create}>
        <label>{tr("Code", "الرمز")}<input name="code" maxLength={80} placeholder={tr("e.g. INSURANCE_ID", "مثال INSURANCE_ID")} required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" maxLength={180} dir="rtl" /></label>
        <label className="checkbox-label"><input name="requiresIssuingCountry" type="checkbox" /> {tr("Require issuing-country code", "طلب رمز بلد الإصدار")}</label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" disabled={Boolean(busy)}>
          {busy === "create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Scheme", "إنشاء النوع")}
        </button>
      </form>}
    </CrudModal>

    <CrudModal open={deactivation !== null} onClose={() => { if (!busy) setDeactivationId(null); }} size="compact"
      title={tr("Deactivate Identifier Scheme", "تعطيل نوع معرّف")}
      description={tr(
        "This deactivates the custom scheme for future use only; existing patient identifiers remain unchanged.",
        "يُعطّل هذا النوع للاستخدام المستقبلي فقط، وتبقى معرّفات المرضى الحالية دون تغيير.",
      )}>
      {deactivation && <form key={deactivation.id} className="catalog-form" onSubmit={deactivate}>
        <p className="form-span"><strong>{deactivation.code}</strong> — {locale === "ar" ?
          deactivation.nameAr || deactivation.nameEn : deactivation.nameEn}</p>
        <label className="form-span">{tr("Reason for deactivation", "سبب التعطيل")}
          <textarea name="reason" required maxLength={1000} />
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" disabled={Boolean(busy)}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm Deactivation", "تأكيد التعطيل")}
        </button>
      </form>}
    </CrudModal>
  </>;
}
