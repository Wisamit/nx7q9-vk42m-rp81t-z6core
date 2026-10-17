"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type Reason = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE";
  updatedAt: string;
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
  const [formError, setFormError] = useState("");
  const [modal, setModal] = useState<"create" | string | null>(null);
  const editing = modal && modal !== "create" ? reasons.find(reason => reason.id === modal) : null;

  function openEditor(id: "create" | string) {
    setMessage("");
    setFormError("");
    setModal(id);
  }

  async function submit(path: "create" | "update", payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/settings/specimen-rejection-reasons", {
        method: path === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFormError(body.error === "rejection_reason_code_exists"
          ? tr("This reason code already exists.", "رمز سبب الرفض موجود مسبقًا.")
          : tr("Could not save rejection reason.", "تعذر حفظ سبب الرفض."));
        return;
      }
      setModal(null);
      setMessage(tr("Rejection reason saved.", "تم حفظ سبب الرفض."));
      router.refresh();
    } catch {
      setFormError(tr("Connection error while saving rejection reason.", "حدث خطأ في الاتصال عند حفظ سبب الرفض."));
    } finally {
      setBusy(false);
    }
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

  return <>
    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr("Configured Rejection Reasons", "أسباب الرفض المهيأة")}</h2>
          <span>{reasons.length} {tr("configured reasons", "سبب مهيأ")}</span>
        </div>
        <button type="button" className="primary-button" disabled={busy}
          onClick={() => openEditor("create")}>
          {tr("Add Rejection Reason", "إضافة سبب رفض")}
        </button>
      </div>
      {message && <p className="form-success" role="status">{message}</p>}
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Code", "الرمز")}</th>
          <th>{tr("English name", "الاسم بالإنجليزية")}</th>
          <th>{tr("Arabic name", "الاسم بالعربية")}</th>
          <th>{tr("Sort order", "ترتيب العرض")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th>{tr("Updated", "آخر تحديث")}</th>
          <th>{tr("Action", "الإجراء")}</th>
        </tr></thead>
        <tbody>{reasons.length === 0
          ? <tr><td colSpan={7} className="empty-state">{tr("No reasons configured.", "لا توجد أسباب مهيأة.")}</td></tr>
          : reasons.map(reason => <tr key={reason.id}>
            <td><strong>{reason.code}</strong></td>
            <td>{reason.nameEn}</td>
            <td>{reason.nameAr || "—"}</td>
            <td>{reason.sortOrder}</td>
            <td>{reason.status === "ACTIVE" ? tr("Active", "فعال") : tr("Inactive", "غير فعال")}</td>
            <td><SystemDateText value={reason.updatedAt} /></td>
            <td><button type="button" className="secondary-button" disabled={busy}
              onClick={() => openEditor(reason.id)}>{tr("Edit", "تعديل")}</button></td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <CrudModal
      open={modal !== null}
      onClose={() => { if (!busy) setModal(null); }}
      size="compact"
      title={modal === "create" ? tr("Add Rejection Reason", "إضافة سبب رفض") :
        tr("Edit Rejection Reason", "تعديل سبب الرفض")}
      description={tr(
        "Changes affect future specimen operations only; existing historical records are preserved.",
        "تؤثر التعديلات على العمليات المستقبلية فقط؛ وتبقى السجلات التاريخية محفوظة.",
      )}
    >
      {modal === "create" ? <form key="create" className="catalog-form" onSubmit={create}>
        <label>{tr("Code", "الرمز")}<input name="code" maxLength={80} placeholder="WRONG_TUBE" required /></label>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} required /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" maxLength={180} /></label>
        <label>{tr("Sort order", "ترتيب العرض")}<input name="sortOrder" type="number" defaultValue={100} min={-10000} max={10000} required /></label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" disabled={busy}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Reason", "إضافة السبب")}
        </button>
      </form> : editing ? <form key={editing.id} className="catalog-form"
        onSubmit={event => update(event, editing.id)}>
        <div className="form-span"><strong>{editing.code}</strong></div>
        <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" maxLength={180} defaultValue={editing.nameEn} required /></label>
        <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" maxLength={180} defaultValue={editing.nameAr || ""} /></label>
        <label>{tr("Sort order", "ترتيب العرض")}<input name="sortOrder" type="number" min={-10000} max={10000} defaultValue={editing.sortOrder} required /></label>
        <label>{tr("Status", "الحالة")}<select name="status" defaultValue={editing.status}>
          <option value="ACTIVE">{tr("Active", "فعال")}</option>
          <option value="INACTIVE">{tr("Inactive", "غير فعال")}</option>
        </select></label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" disabled={busy}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save", "حفظ")}
        </button>
      </form> : null}
    </CrudModal>
  </>;
}
