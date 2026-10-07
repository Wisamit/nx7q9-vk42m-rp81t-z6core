"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Reason = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
};

export function SpecimenRejectionReasonManager({
  reasons,
  locale,
}: {
  reasons: Reason[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(path: "create" | "update", payload: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/settings/specimen-rejection-reasons", {
      method: path === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error === "rejection_reason_code_exists"
        ? tr("This reason code already exists.", "رمز سبب الرفض موجود مسبقًا.")
        : tr("Could not save rejection reason.", "تعذر حفظ سبب الرفض."));
    } else {
      setMessage(tr("Rejection reason saved.", "تم حفظ سبب الرفض."));
      router.refresh();
    }
    setBusy(false);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("create", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      sortOrder: form.get("sortOrder"),
    });
    event.currentTarget.reset();
  }

  async function update(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("update", {
      id,
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      sortOrder: form.get("sortOrder"),
      status: form.get("status"),
    });
  }

  return <div className="admin-grid">
    <section className="detail-card">
      <h2>{tr("Add Rejection Reason", "إضافة سبب رفض")}</h2>
      <form className="catalog-form" onSubmit={create}>
        <label>{tr("Code", "الرمز")}<input name="code" maxLength={80} placeholder="WRONG_TUBE" required /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} required /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" maxLength={180} /></label>
        <label>{tr("Sort order", "ترتيب العرض")}<input name="sortOrder" type="number" defaultValue={100} min={-10000} max={10000} required /></label>
        <button className="primary-button" disabled={busy}>{tr("Add Reason", "إضافة السبب")}</button>
      </form>
      {message && <p className="form-success">{message}</p>}
    </section>

    <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr("Configured Reasons", "أسباب الرفض المهيأة")}</h2><span>{reasons.length}</span></div></div>
      <div className="summary-list">
        {reasons.map(reason => <form key={reason.id} className="catalog-form" onSubmit={event => update(event, reason.id)}>
          <div className="form-span"><strong>{reason.code}</strong></div>
          <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} defaultValue={reason.nameEn} required /></label>
          <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" maxLength={180} defaultValue={reason.nameAr || ""} /></label>
          <label>{tr("Sort order", "ترتيب العرض")}<input name="sortOrder" type="number" min={-10000} max={10000} defaultValue={reason.sortOrder} required /></label>
          <label>{tr("Status", "الحالة")}<select name="status" defaultValue={reason.status}>
            <option value="ACTIVE">{tr("Active", "فعال")}</option>
            <option value="INACTIVE">{tr("Inactive", "غير فعال")}</option>
          </select></label>
          <button className="secondary-button" disabled={busy}>{tr("Save", "حفظ")}</button>
        </form>)}
      </div>
    </section>
  </div>;
}
