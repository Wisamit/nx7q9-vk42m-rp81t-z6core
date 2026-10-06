"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  orderItemId: string;
  specimenId: string;
  performingBranchId: string;
  accession: string;
  patient: string;
  testCode: string;
  testName: string;
  barcode: string;
  branchName: string;
};

export function MicrobiologyManager({
  candidates,
  canEnter,
  canManage,
  locale,
}: {
  candidates: Candidate[];
  canEnter: boolean;
  canManage: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function createCase(candidate: Candidate) {
    setBusy(candidate.orderItemId + candidate.specimenId);
    setMessage("");
    const response = await fetch("/api/microbiology/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId: candidate.orderItemId,
        specimenId: candidate.specimenId,
        performingBranchId: candidate.performingBranchId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    if (response.ok && body.case?.id) {
      router.push(`/microbiology/${body.case.id}`);
    } else {
      setMessage(tr("Could not create microbiology case.", "تعذر إنشاء حالة أحياء دقيقة."));
    }
  }

  async function createMaster(event: FormEvent<HTMLFormElement>, type: "ORGANISM" | "ANTIBIOTIC") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(type);
    setMessage("");
    const response = await fetch("/api/microbiology/master-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        category: form.get("category"),
        drugClass: form.get("drugClass"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? (type === "ORGANISM" ? tr("Organism created.", "تم إنشاء الكائن الدقيق.") : tr("Antibiotic created.", "تم إنشاء المضاد الحيوي.")) : tr("Could not create master data.", "تعذر إنشاء البيانات الأساسية."));
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  return <>
    {canManage && <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>{tr("Add Organism","إضافة كائن دقيق")}</h2>
        <form className="catalog-form" onSubmit={event => void createMaster(event, "ORGANISM")}>
          <label>{tr("Code","الرمز")}<input name="code" required /></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Category","الفئة")}<input name="category" placeholder={tr("Bacteria / fungus / other","بكتيريا / فطريات / أخرى")} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ORGANISM" ? tr("Saving…","جارٍ الحفظ…") : tr("Add Organism","إضافة الكائن")}</button>
        </form>
      </article>
      <article className="detail-card">
        <h2>{tr("Add Antibiotic","إضافة مضاد حيوي")}</h2>
        <form className="catalog-form" onSubmit={event => void createMaster(event, "ANTIBIOTIC")}>
          <label>{tr("Code","الرمز")}<input name="code" required /></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Drug class","الفئة الدوائية")}<input name="drugClass" /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ANTIBIOTIC" ? tr("Saving…","جارٍ الحفظ…") : tr("Add Antibiotic","إضافة المضاد الحيوي")}</button>
        </form>
      </article>
    </section>}

    {message && <p className="form-success">{message}</p>}

    {canEnter && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Ready Microbiology Work","عمل الأحياء الدقيقة الجاهز")}</h2><span>{candidates.length} {tr("ready specimen(s)","عينة جاهزة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Accession / Patient","رقم الطلب / المريض")}</th><th>{tr("Test","الفحص")}</th><th>{tr("Specimen","العينة")}</th><th>{tr("Branch","الفرع")}</th><th>{tr("Action","الإجراء")}</th></tr></thead>
        <tbody>{candidates.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr("No received microbiology specimens are waiting for case creation.","لا توجد عينات أحياء دقيقة مستلمة بانتظار إنشاء حالة.")}</td></tr> : candidates.map(candidate => {
          const key = candidate.orderItemId + candidate.specimenId;
          return <tr key={key}>
            <td><strong>{candidate.accession}</strong><br/><small>{candidate.patient}</small></td>
            <td><strong>{candidate.testCode}</strong><br/><small>{candidate.testName}</small></td>
            <td>{candidate.barcode}</td>
            <td>{candidate.branchName}</td>
            <td><button className="secondary-button" disabled={busy !== ""} onClick={() => void createCase(candidate)}>{busy === key ? tr("Opening…","جارٍ الفتح…") : tr("Start Case","بدء الحالة")}</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>}
  </>;
}
