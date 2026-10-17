"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type Policy = {
  id: string; specimenTypeId: string; minimumDays: number; rationale: string;
  status: string; createdByUserId: string; approvedAt: string | null; createdAt: string;
};
type Case = {
  id: string; status: string; reason: string; retentionDueAt: string;
  requestedByUserId: string; authorizedByUserId: string | null;
  specimen: { barcode: string; status: string };
  policy: { minimumDays: number; status: string };
};
type SpecimenType = { id: string; code: string; nameEn: string; nameAr: string | null };

export function SpecimenRetentionManager({
  locale, policies, cases, specimenTypes, mayConfigure, mayRequest, mayAuthorize, branchTimeZone,
}: {
  locale: "ar" | "en"; policies: Policy[]; cases: Case[]; branchTimeZone?: string;
  specimenTypes: SpecimenType[]; mayConfigure: boolean; mayRequest: boolean; mayAuthorize: boolean;
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const [failed, setFailed] = useState(false);
  const [policyType, setPolicyType] = useState(specimenTypes[0]?.id || "");
  const [days, setDays] = useState("");
  const [rationale, setRationale] = useState("");
  const [barcode, setBarcode] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [executionEvidence, setExecutionEvidence] = useState<Record<string, string>>({});
  const [reviewEvidence, setReviewEvidence] = useState("");

  async function submit(url: string, method: "POST" | "PATCH", payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const result = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: { error?: string } = await result.json().catch(() => ({}));
      setFailed(!result.ok);
      setMessage(result.ok
        ? tr("Action recorded. Refreshing authorized records.", "تم تسجيل العملية وجارٍ تحديث السجلات المصرح بها.")
        : tr("Action was blocked: ", "تم منع الإجراء: ") + (body.error || "unknown_error"));
      if (result.ok) {
        setExecutionEvidence({});
        setReviewEvidence("");
        router.refresh();
      }
    } catch {
      setFailed(true);
      setMessage(tr("Connection error. Nothing was confirmed.", "خطأ اتصال، لم يتم تأكيد تسجيل الإجراء."));
    } finally { setBusy(false); }
  }

  function createPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const minimumDays = Number(days);
    if (!Number.isInteger(minimumDays)) return;
    void submit("/api/specimens/retention-policies", "POST", {
      specimenTypeId: policyType, minimumDays, rationale,
    });
  }

  function requestDisposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("/api/specimens/disposal-cases", "POST", {
      barcode, reason: requestReason,
    });
  }

  return <div className="admin-grid" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="detail-card">
      <h2>{tr("Clinical retention safety", "ضوابط الاحتفاظ السريري بالعينات")}</h2>
      <p className="muted">{tr(
        "No automatic duration or disposal is enabled. A branch- and specimen-type-specific policy requires independent approval. Only prospective samples with completed tests and a released final report qualify; active holds, send-outs, custody or child specimens block disposal.",
        "لا توجد مدة احتفاظ افتراضية أو إتلاف تلقائي. تعتمد سياسة كل فرع ونوع عينة بموافقة مستقلة. لا تُقبل إلا العينات اللاحقة لاعتماد السياسة وبعد إكمال الفحوص وصدور التقرير النهائي؛ وتمنع الطلبات المفتوحة والحجز وسلسلة الحيازة والعينات الفرعية إتلافها."
      )}</p>
      <p className="muted">{tr(
        "Physical custody, legal retention and applicable laboratory policies still require final clinical and regulatory sign-off.",
        "يبقى التحقق من الحيازة الفعلية والمتطلبات القانونية وسياسات المختبر خاضعاً للاعتماد السريري والتنظيمي النهائي."
      )}</p>
    </section>

    {mayConfigure && <section className="detail-card">
      <h2>{tr("Draft retention policy", "إنشاء مسودة سياسة احتفاظ")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("policy"); }}>
     {tr("Create Retention Policy Draft", "إنشاء مسودة سياسة احتفاظ")}
   </button>
   <CrudModal open={uiEditor === "policy"} onClose={() => {if (!busy) setUiEditor("");}}
     size="compact" title={tr("Create Retention Policy Draft", "إنشاء مسودة سياسة احتفاظ")}
     description={tr("Policy drafts require independent approval before they govern specimen disposal.", "تحتاج المسودات إلى اعتماد مستقل قبل تطبيقها على إتلاف العينات.")}>
     {uiEditor === "policy" && <form className="catalog-form" onSubmit={createPolicy}>
        <label>{tr("Specimen type", "نوع العينة")}
          <select value={policyType} onChange={e => setPolicyType(e.target.value)} required>
            {specimenTypes.map(type => <option key={type.id} value={type.id}>
              {type.code} — {locale === "ar" ? type.nameAr || type.nameEn : type.nameEn}
            </option>)}
          </select>
        </label>
        <label>{tr("Minimum complete days (explicit laboratory policy)", "الحد الأدنى لأيام الاحتفاظ (قرار المختبر)")}
          <input type="number" min={1} max={73000} step={1} required value={days}
            onChange={e => setDays(e.target.value)} />
        </label>
        <label>{tr("Policy rationale / approved basis (at least 30 characters)", "مبرر السياسة والأساس المعتمد (30 حرفاً على الأقل)")}
          <textarea rows={3} minLength={30} maxLength={1000} required value={rationale}
            onChange={e => setRationale(e.target.value)} />
        </label>
        <button className="primary-button" type="submit" disabled={busy || !policyType}>
          {tr("Submit draft for independent review", "إرسال المسودة للمراجعة المستقلة")}
        </button>
      </form>}
     {uiEditor === "policy" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    {(mayAuthorize || mayRequest) && <section className="detail-card">
      <h2>{tr("Review or cancellation evidence", "دليل المراجعة أو الإلغاء")}</h2>
      <label>{tr("Document authorization, retirement or cancellation rationale (30+ characters)", "دوّن مبررات الاعتماد أو الإيقاف أو الإلغاء (30 حرفاً على الأقل)")}
        <textarea rows={3} minLength={30} maxLength={1000} value={reviewEvidence}
          onChange={e => setReviewEvidence(e.target.value)} />
      </label>
    </section>}
    <section className="table-card">
      <div className="table-toolbar"><h2>{tr("Retention policy history", "السجل التاريخي لسياسات الاحتفاظ")}</h2></div>
      <div className="summary-list">
        {policies.length === 0 && <p className="muted">{tr("No policies for this branch.", "لا توجد سياسات لهذا الفرع.")}</p>}
        {policies.map(policy => <article key={policy.id} className="detail-card">
          <strong>{specimenTypes.find(t => t.id === policy.specimenTypeId)?.code || policy.specimenTypeId}</strong>
          <p>{tr("Minimum days", "الحد الأدنى بالأيام")}: {policy.minimumDays} · {policy.status}</p>
          <p>{policy.rationale}</p>
          <p>{tr("Created", "تاريخ الإنشاء")}: <SystemDateText value={policy.createdAt} timeZone={branchTimeZone} />{policy.approvedAt && <> · {tr("Approved", "تاريخ الاعتماد")}: <SystemDateText value={policy.approvedAt} timeZone={branchTimeZone} /></>}</p>
          {mayAuthorize && policy.status === "DRAFT" &&
            <button className="secondary-link" type="button" disabled={busy || reviewEvidence.trim().length < 30}
              onClick={() => void submit("/api/specimens/retention-policies", "PATCH", { id: policy.id, action: "APPROVE", reason: reviewEvidence })}>
              {tr("Approve policy independently", "اعتماد السياسة بشكل مستقل")}
            </button>}
          {mayAuthorize && policy.status === "APPROVED" &&
            <button className="secondary-link" type="button" disabled={busy || reviewEvidence.trim().length < 30}
              onClick={() => void submit("/api/specimens/retention-policies", "PATCH", { id: policy.id, action: "RETIRE", reason: reviewEvidence })}>
              {tr("Retire policy", "إيقاف السياسة")}
            </button>}
        </article>)}
      </div>
    </section>

    {mayRequest && <section className="detail-card">
      <h2>{tr("Request retained-specimen disposal", "طلب إتلاف عينة محتفظ بها")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("disposal"); }}>
     {tr("Request Specimen Disposal", "طلب إتلاف عينة")}
   </button>
   <CrudModal open={uiEditor === "disposal"} onClose={() => {if (!busy) setUiEditor("");}}
     size="compact" title={tr("Request Specimen Disposal", "طلب إتلاف عينة")}
     description={tr("Disposal is a high-risk documented request, never automatic destruction.", "الإتلاف طلب عالي الحساسية وموثق، وليس تخلصاً آلياً من العينة.")}>
     {uiEditor === "disposal" && <form className="catalog-form" onSubmit={requestDisposal}>
        <label>{tr("Specimen barcode in current branch", "باركود العينة في الفرع الحالي")}
          <input value={barcode} onChange={e => setBarcode(e.target.value)} maxLength={80} minLength={3} required />
        </label>
        <label>{tr("Reason / evidence (at least 30 characters)", "سبب الطلب والأدلة (30 حرفاً على الأقل)")}
          <textarea value={requestReason} onChange={e => setRequestReason(e.target.value)}
            minLength={30} maxLength={1000} rows={3} required />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {tr("Submit disposal request", "تقديم طلب الإتلاف")}
        </button>
      </form>}
     {uiEditor === "disposal" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr("Disposal authorization register", "سجل تفويضات الإتلاف")}</h2></div>
      <div className="summary-list">
        {cases.length === 0 && <p className="muted">{tr("No disposal requests for this branch.", "لا توجد طلبات إتلاف لهذا الفرع.")}</p>}
        {cases.map(item => <article key={item.id} className="detail-card">
          <strong>{item.specimen.barcode} — {item.status}</strong>
          <p>{tr("Retention due", "انتهاء الحد الأدنى للاحتفاظ")}: <SystemDateText value={item.retentionDueAt} timeZone={branchTimeZone} /></p>
          <p>{tr("Minimum days", "أيام الاحتفاظ")}: {item.policy.minimumDays} · {tr("Sample state", "حالة العينة")}: {item.specimen.status}</p>
          <p>{item.reason}</p>
          {mayAuthorize && item.status === "REQUESTED" &&
            <button type="button" className="secondary-link" disabled={busy || reviewEvidence.trim().length < 30}
              onClick={() => void submit("/api/specimens/disposal-cases", "PATCH", { id: item.id, action: "AUTHORIZE", evidence: reviewEvidence })}>
              {tr("Authorize independently", "الموافقة المستقلة")}
            </button>}
          {mayRequest && item.status === "AUTHORIZED" && <div className="catalog-form">
            <label>{tr("Physical disposal evidence / method (30+ characters)", "دليل ووسيلة الإتلاف الفعلي (30 حرفاً على الأقل)")}
              <textarea rows={3} minLength={30} maxLength={1000} value={executionEvidence[item.id] || ""}
                onChange={e => setExecutionEvidence(previous => ({ ...previous, [item.id]: e.target.value }))} />
            </label>
            <button type="button" className="primary-button" disabled={busy || (executionEvidence[item.id] || "").trim().length < 30}
              onClick={() => void submit("/api/specimens/disposal-cases", "PATCH", { id: item.id, action: "EXECUTE", evidence: executionEvidence[item.id] || "" })}>
              {tr("Record physical disposal", "تسجيل الإتلاف الفعلي")}
            </button>
          </div>}
          {(mayRequest || mayAuthorize) && ["REQUESTED", "AUTHORIZED"].includes(item.status) &&
            <button type="button" className="secondary-link" disabled={busy || reviewEvidence.trim().length < 30}
              onClick={() => void submit("/api/specimens/disposal-cases", "PATCH", { id: item.id, action: "CANCEL", evidence: reviewEvidence })}>
              {tr("Cancel request", "إلغاء الطلب")}
            </button>}
        </article>)}
      </div>
    </section>
    {message && <p role="status" className={failed ? "form-error" : "form-success"}>{message}</p>}
  </div>;
}
