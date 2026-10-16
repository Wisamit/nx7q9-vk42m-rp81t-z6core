"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const [editor, setEditor] = useState<"ORGANISM"|"ANTIBIOTIC"|null>(null);
  const [caseReview, setCaseReview] = useState<Candidate|null>(null);
  const [formError, setFormError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function createCase(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate=caseReview;
    if(!candidate||busy||!canEnter) return;
    if(!candidates.some(row=>row.orderItemId===candidate.orderItemId
      &&row.specimenId===candidate.specimenId
      &&row.performingBranchId===candidate.performingBranchId)) {
      setFormError(tr("Specimen is no longer available. Refresh before proceeding.",
        "لم تعد العينة متاحة؛ حدّث الصفحة قبل المتابعة."));
      return;
    }
    setBusy(candidate.orderItemId+candidate.specimenId);
    setFormError("");
    try {
      const response=await fetch("/api/microbiology/cases",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          orderItemId:candidate.orderItemId,
          specimenId:candidate.specimenId,
          performingBranchId:candidate.performingBranchId,
        }),
      });
      const body=await response.json().catch(()=>({})) as {case?:{id?:string};error?:string};
      if(!response.ok||!body.case?.id) {
        setFormError(body.error||tr("Could not create microbiology case.","تعذر إنشاء حالة أحياء دقيقة."));
        return;
      }
      setCaseReview(null);
      router.push(`/microbiology/${body.case.id}`);
    }catch {
      setFormError(tr("Connection interrupted; verify specimen case status before retrying.",
        "انقطع الاتصال؛ تحقق من وجود حالة للعينة قبل إعادة المحاولة."));
    }finally {setBusy("");}
  }

  async function createMaster(event:FormEvent<HTMLFormElement>,type:"ORGANISM"|"ANTIBIOTIC") {
    event.preventDefault();
    if(busy||!canManage)return;
    const form=new FormData(event.currentTarget);
    setBusy(type);
    setFormError("");
    try {
      const response=await fetch("/api/microbiology/master-data",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          type,
          code:form.get("code"),
          nameEn:form.get("nameEn"),
          nameAr:form.get("nameAr"),
          category:form.get("category"),
          drugClass:form.get("drugClass"),
        }),
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) {
        setFormError(body.error||tr("Could not create master data.","تعذر إنشاء البيانات الأساسية."));
        return;
      }
      setEditor(null);
      setMessage(type==="ORGANISM"
        ?tr("Organism created.","تم إنشاء الكائن الدقيق.")
        :tr("Antibiotic created.","تم إنشاء المضاد الحيوي."));
      router.refresh();
    }catch{
      setFormError(tr("Connection interrupted; review existing master records before retrying.",
        "انقطع الاتصال؛ راجع البيانات المرجعية قبل إعادة المحاولة."));
    }finally{setBusy("");}
  }

  return <>
    {canManage && <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>{tr("Add Organism","إضافة كائن دقيق")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={()=>{setMessage("");setFormError("");setEditor("ORGANISM");}}>
      {tr("Add Organism","إضافة كائن دقيق")}
    </button>
    <CrudModal open={editor==="ORGANISM"} onClose={()=>{if(!busy)setEditor(null);}}
      size="compact"
      title={tr("Add Organism","إضافة كائن دقيق")}
      description={tr(
        "Create configuration-driven microbiology master data. Codes and meanings must be checked against authorized laboratory policies.",
        "أنشئ بيانات مرجعية للأحياء الدقيقة وفق التهيئة؛ راجع الرموز والمعاني مقابل سياسات المختبر المعتمدة.",
      )}>
      {editor==="ORGANISM"&&<form className="catalog-form" onSubmit={event => void createMaster(event, "ORGANISM")}>
          <label>{tr("Code","الرمز")}<input name="code" required /></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Category","الفئة")}<input name="category" placeholder={tr("Bacteria / fungus / other","بكتيريا / فطريات / أخرى")} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ORGANISM" ? tr("Saving…","جارٍ الحفظ…") : tr("Add Organism","إضافة الكائن")}</button>
        </form>}
      {editor==="ORGANISM"&&formError&&<p className="form-error" role="alert">{formError}</p>}
    </CrudModal>
      </article>
      <article className="detail-card">
        <h2>{tr("Add Antibiotic","إضافة مضاد حيوي")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={()=>{setMessage("");setFormError("");setEditor("ANTIBIOTIC");}}>
      {tr("Add Antibiotic","إضافة مضاد حيوي")}
    </button>
    <CrudModal open={editor==="ANTIBIOTIC"} onClose={()=>{if(!busy)setEditor(null);}}
      size="compact"
      title={tr("Add Antibiotic","إضافة مضاد حيوي")}
      description={tr(
        "Create configuration-driven microbiology master data. Codes and meanings must be checked against authorized laboratory policies.",
        "أنشئ بيانات مرجعية للأحياء الدقيقة وفق التهيئة؛ راجع الرموز والمعاني مقابل سياسات المختبر المعتمدة.",
      )}>
      {editor==="ANTIBIOTIC"&&<form className="catalog-form" onSubmit={event => void createMaster(event, "ANTIBIOTIC")}>
          <label>{tr("Code","الرمز")}<input name="code" required /></label>
          <label>{tr("English name","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
          <label>{tr("Arabic name","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
          <label>{tr("Drug class","الفئة الدوائية")}<input name="drugClass" /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ANTIBIOTIC" ? tr("Saving…","جارٍ الحفظ…") : tr("Add Antibiotic","إضافة المضاد الحيوي")}</button>
        </form>}
      {editor==="ANTIBIOTIC"&&formError&&<p className="form-error" role="alert">{formError}</p>}
    </CrudModal>
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
            <td><button className="secondary-button" disabled={busy !== ""} onClick={() => {setMessage("");setFormError("");setCaseReview(candidate);}}>{busy === key ? tr("Opening…","جارٍ الفتح…") : tr("Start Case","بدء الحالة")}</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>}
    <CrudModal open={caseReview!==null} onClose={()=>{if(!busy)setCaseReview(null);}}
      size="compact"
      title={tr("Start Microbiology Case","بدء حالة أحياء دقيقة")}
      description={tr(
        "Verify the accession, specimen barcode and performing branch. Creating a case never releases clinical results.",
        "تحقق من رقم الطلب وباركود العينة والفرع المنفّذ. إنشاء الحالة لا يصدر نتائج سريرية.",
      )}>
      {caseReview&&<form className="catalog-form" onSubmit={createCase}>
        <div className="form-span">
          <p><strong>{caseReview.accession}</strong> · {caseReview.patient}</p>
          <p>{caseReview.testCode} — {caseReview.testName}</p>
          <p>{tr("Specimen barcode","باركود العينة")}: <strong>{caseReview.barcode}</strong></p>
          <p>{tr("Performing branch","الفرع المنفّذ")}: {caseReview.branchName}</p>
        </div>
        {formError&&<p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
          {busy?tr("Creating…","جارٍ الإنشاء…"):tr("Confirm case creation","تأكيد إنشاء الحالة")}
        </button>
      </form>}
    </CrudModal>
  </>;
}
