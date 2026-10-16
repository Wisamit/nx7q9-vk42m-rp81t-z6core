"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type ClientOption = { id: string; code: string; nameEn: string; nameAr?: string | null };

export function ClientReferrerForms({
  clients,
  canManageSources = false,
  locale,
}: {
  clients: ClientOption[];
  canManageSources?: boolean;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: ClientOption) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const clientTypeLabel = (value: string) => ({ INDIVIDUAL: tr("Individual","فرد"), CLINIC: tr("Clinic","عيادة"), HOSPITAL: tr("Hospital","مستشفى"), COMPANY: tr("Company","شركة"), INSURANCE: tr("Insurance","تأمين"), OTHER: tr("Other","أخرى") }[value] || value);
  const referrerTypeLabel = (value: string) => ({ PHYSICIAN: tr("Physician","طبيب"), CLINIC: tr("Clinic","عيادة"), HOSPITAL: tr("Hospital","مستشفى"), OTHER: tr("Other","أخرى") }[value] || value);
  const router = useRouter();
  const [clientMessage, setClientMessage] = useState("");
  const [referrerMessage, setReferrerMessage] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [busy, setBusy] = useState<"client" | "referrer" | "source" | "">("");
  const [open, setOpen] = useState<"client" | "referrer" | "source" | "">("");

  async function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("client"); setClientMessage("");
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        type: form.get("type"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        phone: form.get("phone"),
        email: form.get("email"),
        paymentTermsDays: form.get("paymentTermsDays"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setClientMessage(`${tr("Client created", "تم إنشاء العميل")}: ${body.client.code}`);
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setClientMessage(body.error || tr("Client creation failed.", "تعذر إنشاء العميل."));
    setBusy("");
  }

  async function submitReferrer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("referrer"); setReferrerMessage("");
    const response = await fetch("/api/referrers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        type: form.get("type"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        phone: form.get("phone"),
        email: form.get("email"),
        licenseNumber: form.get("licenseNumber"),
        clientId: form.get("clientId"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setReferrerMessage(`${tr("Referrer created", "تم إنشاء المحيل")}: ${body.referrer.code}`);
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setReferrerMessage(body.error || tr("Referrer creation failed.", "تعذر إنشاء المحيل."));
    setBusy("");
  }


  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("source"); setSourceMessage("");
    const response = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        category: form.get("category"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setSourceMessage(`${tr("Source created", "تم إنشاء المصدر")}: ${body.source.code}`);
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setSourceMessage(body.error || tr("Source creation failed.", "تعذر إنشاء المصدر."));
    setBusy("");
  }

  return <>
    <div className="crud-action-bar">
      <div>
        {clientMessage && <span className="crud-success-toast">{clientMessage}</span>}
        {referrerMessage && <span className="crud-success-toast">{referrerMessage}</span>}
        {sourceMessage && <span className="crud-success-toast">{sourceMessage}</span>}
      </div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" onClick={() => { setClientMessage(""); setOpen("client"); }}><SystemIcon name="plus" size={16}/>{tr("Add Client", "إضافة عميل")}</button>
        <button type="button" className="secondary-button" onClick={() => { setReferrerMessage(""); setOpen("referrer"); }}><SystemIcon name="plus" size={16}/>{tr("Add Referrer", "إضافة محيل")}</button>
        {canManageSources && <button type="button" className="secondary-button" onClick={() => { setSourceMessage(""); setOpen("source"); }}><SystemIcon name="plus" size={16}/>{tr("Add Source", "إضافة مصدر")}</button>}
      </div>
    </div>

    <CrudModal open={open === "client"} onClose={() => setOpen("")} title={tr("Add Client", "إضافة عميل")} description={tr("Create a billing/commercial client account.", "إنشاء حساب عميل تجاري أو حساب فوترة.")} size="compact">
      <form className="catalog-form" onSubmit={submitClient}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Type", "النوع")}<select name="type" defaultValue="CLINIC"><option value="INDIVIDUAL">{clientTypeLabel("INDIVIDUAL")}</option><option value="CLINIC">{clientTypeLabel("CLINIC")}</option><option value="HOSPITAL">{clientTypeLabel("HOSPITAL")}</option><option value="COMPANY">{clientTypeLabel("COMPANY")}</option><option value="INSURANCE">{clientTypeLabel("INSURANCE")}</option><option value="OTHER">{clientTypeLabel("OTHER")}</option></select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Payment terms (days)", "شروط الدفع (أيام)")}<input name="paymentTermsDays" type="number" min="0" max="3650" /></label>
        <button className="primary-button form-span" disabled={busy === "client"}>{busy === "client" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Client", "إنشاء العميل")}</button>
        {clientMessage && <div className="form-success form-span">{clientMessage}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "referrer"} onClose={() => setOpen("")} title={tr("Add Referrer", "إضافة محيل")} description={tr("Create a doctor, clinic or hospital referral source.", "إنشاء مصدر إحالة لطبيب أو عيادة أو مستشفى.")} size="compact">
      <form className="catalog-form" onSubmit={submitReferrer}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Type", "النوع")}<select name="type" defaultValue="PHYSICIAN"><option value="PHYSICIAN">{referrerTypeLabel("PHYSICIAN")}</option><option value="CLINIC">{referrerTypeLabel("CLINIC")}</option><option value="HOSPITAL">{referrerTypeLabel("HOSPITAL")}</option><option value="OTHER">{referrerTypeLabel("OTHER")}</option></select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>{tr("License #", "رقم الترخيص")}<input name="licenseNumber" /></label>
        <label>{tr("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Billing client", "عميل الفوترة")}<select name="clientId" defaultValue=""><option value="">{tr("No linked client","لا يوجد عميل مرتبط")}</option>{clients.map(client => <option key={client.id} value={client.id}>{client.code} — {localizedName(client)}</option>)}</select></label>
        <button className="primary-button form-span" disabled={busy === "referrer"}>{busy === "referrer" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Referrer", "إنشاء المحيل")}</button>
        {referrerMessage && <div className="form-success form-span">{referrerMessage}</div>}
      </form>
    </CrudModal>

    {canManageSources && <CrudModal open={open === "source"} onClose={() => setOpen("")} title={tr("Add Order Source", "إضافة مصدر طلب")} description={tr("Create a configurable acquisition/source category for orders and analytics.", "إنشاء مصدر قابل للتهيئة للطلبات والتحليلات.")} size="compact">
      <form className="catalog-form" onSubmit={submitSource}>
        <label>{tr("Code", "الرمز")}<input name="code" required placeholder="WALK_IN / CAMPAIGN / INSURANCE" /></label>
        <label>{tr("Category", "الفئة")}<input name="category" required placeholder="WALK_IN / DOCTOR / CORPORATE" /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy === "source"}>{busy === "source" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Source", "إنشاء المصدر")}</button>
        {sourceMessage && <div className="form-success form-span">{sourceMessage}</div>}
      </form>
    </CrudModal>}
  </>;
}
