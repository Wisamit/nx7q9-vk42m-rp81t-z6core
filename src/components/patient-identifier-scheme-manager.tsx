"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setMessage("");
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
      event.currentTarget.reset();
      setMessage(tr("Identifier scheme created.", "تم إنشاء نوع المعرّف."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not create identifier scheme.", "تعذر إنشاء نوع المعرّف."));
    }
    setBusy("");
  }

  async function deactivate(scheme: Scheme) {
    const reason = prompt(tr("Reason for deactivation:", "سبب التعطيل:"));
    if (reason === null) return;
    if (!reason.trim()) {
      setMessage(tr("A reason is required.", "السبب مطلوب."));
      return;
    }
    setBusy(scheme.id);
    setMessage("");
    const response = await fetch("/api/patients/identifier-schemes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scheme.id, reason: reason.trim() }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setMessage(tr("Identifier scheme deactivated.", "تم تعطيل نوع المعرّف."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not deactivate identifier scheme.", "تعذر تعطيل نوع المعرّف."));
    }
    setBusy("");
  }

  return <>
    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr("Identifier Schemes", "أنواع معرّفات المرضى")}</h2>
          <span>{tr("Standard schemes stay available; custom schemes are soft-deactivated.", "تبقى الأنواع القياسية متاحة، ويتم تعطيل الأنواع المخصصة دون حذفها.")}</span>
        </div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Code", "الرمز")}</th>
          <th>{tr("Name", "الاسم")}</th>
          <th>{tr("Base type", "النوع الأساسي")}</th>
          <th>{tr("Issuing country", "بلد الإصدار")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th></th>
        </tr></thead>
        <tbody>{schemes.map(scheme => <tr key={scheme.id}>
          <td><strong>{scheme.code}</strong></td>
          <td>{locale === "ar" ? scheme.nameAr || scheme.nameEn : scheme.nameEn}</td>
          <td>{scheme.identifierType}</td>
          <td>{scheme.requiresIssuingCountry ? tr("Required", "مطلوب") : tr("Optional", "اختياري")}</td>
          <td>{scheme.status}</td>
          <td>{scheme.identifierType === "OTHER" && scheme.code !== "LEGACY_OTHER" && scheme.status === "ACTIVE"
            ? <button type="button" className="secondary-button" disabled={busy === scheme.id} onClick={() => void deactivate(scheme)}>
                {tr("Deactivate", "تعطيل")}
              </button>
            : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-card">
      <h2>{tr("Add Custom Identifier Scheme", "إضافة نوع معرّف مخصص")}</h2>
      <form className="catalog-form" onSubmit={create}>
        <label>{tr("Code", "الرمز")}<input name="code" maxLength={80} placeholder={tr("e.g. INSURANCE_ID", "مثال INSURANCE_ID")} required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" maxLength={180} dir="rtl" /></label>
        <label className="checkbox-label"><input name="requiresIssuingCountry" type="checkbox" /> {tr("Require issuing-country code", "طلب رمز بلد الإصدار")}</label>
        <button className="primary-button form-span" disabled={busy === "create"}>{busy === "create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Scheme", "إنشاء النوع")}</button>
      </form>
      {message && <p className="form-warning">{message}</p>}
    </section>
  </>;
}
