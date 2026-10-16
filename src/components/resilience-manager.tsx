"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type RetentionPolicy = {
  id: string;
  dataClass: string;
  action: string;
  retainDays: number | null;
  archiveAfterDays: number | null;
  enabled: boolean;
};

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function ResilienceManager({
  branches,
  retentionPolicies,
  canManage,
  canArchive,
  locale,
}: {
  branches: Branch[];
  retentionPolicies: RetentionPolicy[];
  canManage: boolean;
  canArchive: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const [purgePolicy, setPurgePolicy] = useState<RetentionPolicy|null>(null);
  const [formError, setFormError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const branchName = (branch: Branch) => locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;
  const modeLabel = (value: string) =>
    value === "CENTRAL_ONLY" ? tr("Central only", "مركزي فقط") :
    value === "READ_ONLY_CACHE" ? tr("Read-only cache", "ذاكرة مؤقتة للقراءة فقط") :
    value === "BUFFER_NON_CLINICAL" ? tr("Buffer non-clinical events", "تخزين مؤقت للأحداث غير السريرية") :
    value;
  const statusLabel = (value: string) =>
    value === "RECORDED" ? tr("Recorded", "مسجل") :
    value === "VERIFIED" ? tr("Verified", "متحقق منه") :
    value === "FAILED" ? tr("Failed", "فشل") :
    value === "PLANNED" ? tr("Planned", "مخطط") :
    value === "IN_PROGRESS" ? tr("In progress", "قيد التنفيذ") :
    value === "PASSED" ? tr("Passed", "ناجح") :
    value === "CANCELLED" ? tr("Cancelled", "ملغى") :
    value;
  const actionLabel = (value: string) =>
    value === "RETAIN_ONLY" ? tr("Retain only", "احتفاظ فقط") :
    value === "ARCHIVE" ? tr("Archive", "أرشفة") :
    value === "PURGE" ? tr("Purge", "حذف نهائي") :
    value;
  const dataClassLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      ANALYZER_MESSAGES: ["Analyzer messages", "رسائل الأجهزة"],
      INTEGRATION_MESSAGES: ["Integration messages", "رسائل التكامل"],
      WEBHOOK_DELIVERIES: ["Webhook deliveries", "عمليات تسليم Webhook"],
      PORTAL_SESSIONS: ["Portal sessions", "جلسات البوابة"],
      USER_SESSIONS: ["User sessions", "جلسات المستخدمين"],
      AUDIT_EVENTS: ["Audit events", "أحداث التدقيق"],
      CLINICAL_RESULTS: ["Clinical results", "النتائج السريرية"],
      DIAGNOSTIC_REPORTS: ["Diagnostic reports", "التقارير التشخيصية"],
    };
    const label = labels[value];
    return label ? tr(label[0], label[1]) : value;
  };

  async function send(name: string, url: string, body: unknown) {
    if (busy) return false;
    setBusy(name); setFormError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as {error?:string};
      if (!response.ok) {
        setFormError(data.error || tr("Operation failed.", "فشلت العملية."));
        return false;
      }
      setMessage(tr("Saved successfully.", "تم الحفظ بنجاح."));
      setUiEditor("");
      setPurgePolicy(null);
      router.refresh();
      return true;
    } catch {
      setFormError(tr("Connection interrupted; verify the latest audited state before retrying.",
        "انقطع الاتصال؛ تحقق من آخر حالة مدققة قبل إعادة المحاولة."));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function continuity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await send("continuity", "/api/resilience/continuity", {
      branchId: field(f,"branchId"),
      mode: field(f,"mode"),
      localBufferMinutes: field(f,"localBufferMinutes"),
      notes: field(f,"notes"),
    });
  }

  async function edgeNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await send("edge", "/api/resilience/edge-nodes", {
      branchId: field(f,"branchId"),
      code: field(f,"code"),
      name: field(f,"name"),
      softwareVersion: field(f,"softwareVersion"),
    });
  }

  async function backup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await send("backup", "/api/resilience/backups", {
      branchId: field(f,"branchId"),
      provider: field(f,"provider"),
      backupReference: field(f,"backupReference"),
      backupCreatedAt: field(f,"backupCreatedAt"),
      status: field(f,"status"),
      restoreTestedAt: field(f,"restoreTestedAt"),
      restoreDurationMinutes: field(f,"restoreDurationMinutes"),
      evidenceReference: field(f,"evidenceReference"),
      notes: field(f,"notes"),
    });
  }

  async function drill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await send("drill", "/api/resilience/drills", {
      branchId: field(f,"branchId"),
      title: field(f,"title"),
      status: field(f,"status"),
      targetRpoMinutes: field(f,"targetRpoMinutes"),
      targetRtoMinutes: field(f,"targetRtoMinutes"),
      actualRpoMinutes: field(f,"actualRpoMinutes"),
      actualRtoMinutes: field(f,"actualRtoMinutes"),
      scheduledAt: field(f,"scheduledAt"),
      completedAt: field(f,"completedAt"),
      evidenceReference: field(f,"evidenceReference"),
      findings: field(f,"findings"),
      correctiveActions: field(f,"correctiveActions"),
    });
  }

  async function retention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await send("retention", "/api/resilience/retention", {
      dataClass: field(f,"dataClass"),
      action: field(f,"action"),
      retainDays: field(f,"retainDays"),
      archiveAfterDays: field(f,"archiveAfterDays"),
      enabled: f.get("enabled") === "on",
      notes: field(f,"notes"),
    });
  }

  async function preview(policy: RetentionPolicy) {
    if (busy) return;
    setBusy("preview-" + policy.id); setMessage(""); setFormError("");
    try {
      const response = await fetch("/api/resilience/retention/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataClass: policy.dataClass }),
      });
      const data = await response.json().catch(() => ({})) as {candidateCount?:number;executable?:boolean;error?:string};
      if (!response.ok) {
        setMessage(data.error || tr("Preview failed.", "فشلت المعاينة."));
        return;
      }
      setMessage(`${dataClassLabel(policy.dataClass)}: ${data.candidateCount ?? 0} ${tr("candidate(s).", "سجل مرشح.")} ${data.executable
        ? tr("In-app purge is permitted for expired/revoked sessions only.", "الحذف داخل النظام مسموح فقط للجلسات المنتهية أو الملغاة.")
        : tr("No in-app destructive action permitted.", "لا يُسمح بأي إجراء إتلافي داخل النظام.")}`);
    } catch {
      setMessage(tr("Connection failed during preview.", "فشل الاتصال أثناء المعاينة."));
    } finally {
      setBusy("");
    }
  }

  function openPurge(policy: RetentionPolicy) {
    if (busy || !canArchive || !policy.enabled || policy.action !== "PURGE" ||
      !["USER_SESSIONS","PORTAL_SESSIONS"].includes(policy.dataClass)) return;
    setPurgePolicy(policy);
    setFormError("");
    setMessage("");
  }

  async function purge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const policy = purgePolicy;
    if (!policy || busy || !canArchive || !policy.enabled || policy.action !== "PURGE" ||
      !["USER_SESSIONS","PORTAL_SESSIONS"].includes(policy.dataClass)) return;
    await send("purge-" + policy.id, "/api/resilience/retention/execute", {
      policyId: policy.id,
      confirm: "PURGE_EXPIRED_SESSIONS",
    });
  }

  if (!canManage) {
    return message ? <p className="form-success">{message}</p> : null;
  }

  return <section className="detail-grid resilience-admin-grid">
    <article className="detail-card">
      <h2>{tr("Branch Continuity", "استمرارية الفرع")}</h2>
      <p className="muted">{tr("Offline clinical writes remain disabled. BUFFER_NON_CLINICAL is limited to explicitly allowed operational events.", "تبقى الكتابات السريرية دون اتصال معطلة. وضع BUFFER_NON_CLINICAL محدود بالأحداث التشغيلية المسموح بها صراحةً.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={()=>{setMessage("");setFormError("");setUiEditor("continuity");}}>
    {tr("Branch Continuity Policy","سياسة استمرارية الفرع")}
  </button>
  <CrudModal open={uiEditor==="continuity"} onClose={()=>{if(!busy)setUiEditor("");}}
    size="compact" title={tr("Branch Continuity Policy","سياسة استمرارية الفرع")}
    description={tr("Clinical offline writes remain disabled; this policy controls only permitted branch continuity.","تبقى الكتابات السريرية دون اتصال معطّلة؛ تضبط هذه السياسة الاستمرارية المسموحة فقط.")}>
    {uiEditor==="continuity"&&<form className="catalog-form" onSubmit={continuity}>
        <label>{tr("Branch", "الفرع")}<select name="branchId" required>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {branchName(b)}</option>)}</select></label>
        <label>{tr("Mode", "الوضع")}<select name="mode" defaultValue="CENTRAL_ONLY"><option value="CENTRAL_ONLY">{modeLabel("CENTRAL_ONLY")}</option><option value="READ_ONLY_CACHE">{modeLabel("READ_ONLY_CACHE")}</option><option value="BUFFER_NON_CLINICAL">{modeLabel("BUFFER_NON_CLINICAL")}</option></select></label>
        <label>{tr("Local buffer minutes", "مدة التخزين المؤقت المحلي بالدقائق")}<input name="localBufferMinutes" type="number" min="1" max="1440" /></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="continuity"}>{busy==="continuity"?tr("Saving…", "جارٍ الحفظ…"):tr("Save continuity policy", "حفظ سياسة الاستمرارية")}</button>
      </form>}
    {uiEditor==="continuity"&&formError&&<p className="form-error" role="alert">{formError}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Register Edge Node", "تسجيل عقدة Edge")}</h2>
      <p className="muted">{tr("Requires the selected branch to use BUFFER_NON_CLINICAL mode.", "يتطلب أن يستخدم الفرع المحدد وضع BUFFER_NON_CLINICAL.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={()=>{setMessage("");setFormError("");setUiEditor("edge");}}>
    {tr("Register Edge Node","تسجيل عقدة Edge")}
  </button>
  <CrudModal open={uiEditor==="edge"} onClose={()=>{if(!busy)setUiEditor("");}}
    size="compact" title={tr("Register Edge Node","تسجيل عقدة Edge")}
    description={tr("Registration requires branch-specific non-clinical buffering governance.","يتطلب التسجيل حوكمة التخزين المؤقت غير السريري حسب الفرع.")}>
    {uiEditor==="edge"&&<form className="catalog-form" onSubmit={edgeNode}>
        <label>{tr("Branch", "الفرع")}<select name="branchId" required>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {branchName(b)}</option>)}</select></label>
        <label>{tr("Code", "الرمز")}<input name="code" required placeholder="ALAIN-EDGE-01" /></label>
        <label>{tr("Name", "الاسم")}<input name="name" required /></label>
        <label>{tr("Software version", "إصدار البرنامج")}<input name="softwareVersion" /></label>
        <button className="primary-button form-span" disabled={busy==="edge"}>{busy==="edge"?tr("Saving…", "جارٍ الحفظ…"):tr("Register edge node", "تسجيل عقدة Edge")}</button>
      </form>}
    {uiEditor==="edge"&&formError&&<p className="form-error" role="alert">{formError}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Backup Evidence", "دليل النسخ الاحتياطي")}</h2>
      <p className="muted">{tr("Records evidence from the actual database/file backup system; this does not claim that the LIS itself created the backup.", "يسجل دليلاً من نظام النسخ الاحتياطي الفعلي لقاعدة البيانات/الملفات، ولا يعني أن LIS نفسه أنشأ النسخة الاحتياطية.")}</p>
      <p className="muted">{tr("VERIFIED requires an isolated restore completed after backup creation, duration and external evidence reference; recording this status does not create or validate a backup automatically.", "حالة متحقق منه تتطلب اختبار استعادة مستقل بعد إنشاء النسخة، مع المدة ومرجع الدليل الخارجي؛ تسجيل الحالة لا ينشئ نسخة احتياطية ولا يتحقق منها تلقائياً.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={()=>{setMessage("");setFormError("");setUiEditor("backup");}}>
    {tr("Record Backup Evidence","تسجيل دليل نسخة احتياطية")}
  </button>
  <CrudModal open={uiEditor==="backup"} onClose={()=>{if(!busy)setUiEditor("");}}
    size="compact" title={tr("Record Backup Evidence","تسجيل دليل نسخة احتياطية")}
    description={tr("Record external evidence only. This form does not create or verify a real backup/restore.","سجّل الدليل الخارجي فقط؛ هذه الواجهة لا تنشئ نسخة احتياطية ولا تتحقق من استعادتها.")}>
    {uiEditor==="backup"&&<form className="catalog-form" onSubmit={backup}>
        <label>{tr("Scope", "النطاق")}<select name="branchId"><option value="">{tr("Organization-wide", "على مستوى المؤسسة")}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {branchName(b)}</option>)}</select></label>
        <label>{tr("Provider", "المزود")}<input name="provider" required placeholder={tr("DB provider / object storage", "مزود قاعدة البيانات / تخزين الكائنات")} /></label>
        <label className="form-span">{tr("Backup reference", "مرجع النسخة الاحتياطية")}<input name="backupReference" required /></label>
        <label>{tr("Backup created", "وقت إنشاء النسخة")}<input name="backupCreatedAt" type="datetime-local" required /></label>
        <label>{tr("Status", "الحالة")}<select name="status" defaultValue="RECORDED"><option value="RECORDED">{statusLabel("RECORDED")}</option><option value="VERIFIED">{statusLabel("VERIFIED")}</option><option value="FAILED">{statusLabel("FAILED")}</option></select></label>
        <label>{tr("Restore tested", "وقت اختبار الاستعادة")}<input name="restoreTestedAt" type="datetime-local" /></label>
        <label>{tr("Restore duration (min)", "مدة الاستعادة (دقيقة)")}<input name="restoreDurationMinutes" type="number" min="0" /></label>
        <label className="form-span">{tr("Evidence reference", "مرجع الدليل")}<input name="evidenceReference" /></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="backup"}>{busy==="backup"?tr("Saving…", "جارٍ الحفظ…"):tr("Record backup evidence", "تسجيل دليل النسخ الاحتياطي")}</button>
      </form>}
    {uiEditor==="backup"&&formError&&<p className="form-error" role="alert">{formError}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Disaster Recovery Drill", "اختبار التعافي من الكوارث")}</h2>
      <p className="muted">{tr("PASSED/FAILED require completion time, actual RPO/RTO and evidence. PASSED is refused if either recovery target was missed.", "نجاح أو فشل الاختبار يتطلب وقت الاكتمال وRPO/RTO الفعليين ومرجع الدليل. لا يُقبل وصف الاختبار بالناجح إذا تجاوز أي هدف للتعافي.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={()=>{setMessage("");setFormError("");setUiEditor("drill");}}>
    {tr("Document Disaster Recovery Drill","توثيق اختبار التعافي من الكوارث")}
  </button>
  <CrudModal open={uiEditor==="drill"} onClose={()=>{if(!busy)setUiEditor("");}}
    size="compact" title={tr("Document Disaster Recovery Drill","توثيق اختبار التعافي من الكوارث")}
    description={tr("The real RPO/RTO, timing and evidence must be measured and verified; this form does not perform an actual drill.","يجب قياس RPO/RTO الفعلي والتوقيت والدليل؛ تسجيل البيانات لا يجري اختبار استعادة فعلياً.")}>
    {uiEditor==="drill"&&<form className="catalog-form" onSubmit={drill}>
        <label>{tr("Scope", "النطاق")}<select name="branchId"><option value="">{tr("Organization-wide", "على مستوى المؤسسة")}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {branchName(b)}</option>)}</select></label>
        <label>{tr("Title", "العنوان")}<input name="title" required /></label>
        <label>{tr("Status", "الحالة")}<select name="status" defaultValue="PLANNED"><option value="PLANNED">{statusLabel("PLANNED")}</option><option value="IN_PROGRESS">{statusLabel("IN_PROGRESS")}</option><option value="PASSED">{statusLabel("PASSED")}</option><option value="FAILED">{statusLabel("FAILED")}</option><option value="CANCELLED">{statusLabel("CANCELLED")}</option></select></label>
        <label>{tr("Scheduled", "المجدول")}<input name="scheduledAt" type="datetime-local" required /></label>
        <label>{tr("Target RPO min", "RPO المستهدف بالدقائق")}<input name="targetRpoMinutes" type="number" min="0" required /></label>
        <label>{tr("Target RTO min", "RTO المستهدف بالدقائق")}<input name="targetRtoMinutes" type="number" min="0" required /></label>
        <label>{tr("Actual RPO min", "RPO الفعلي بالدقائق")}<input name="actualRpoMinutes" type="number" min="0" /></label>
        <label>{tr("Actual RTO min", "RTO الفعلي بالدقائق")}<input name="actualRtoMinutes" type="number" min="0" /></label>
        <label>{tr("Completed", "تاريخ الاكتمال")}<input name="completedAt" type="datetime-local" /></label>
        <label>{tr("Evidence", "الدليل")}<input name="evidenceReference" /></label>
        <label className="form-span">{tr("Findings", "النتائج والملاحظات")}<input name="findings" /></label>
        <label className="form-span">{tr("Corrective actions", "الإجراءات التصحيحية")}<input name="correctiveActions" /></label>
        <button className="primary-button form-span" disabled={busy==="drill"}>{busy==="drill"?tr("Saving…", "جارٍ الحفظ…"):tr("Record DR drill", "تسجيل اختبار DR")}</button>
      </form>}
    {uiEditor==="drill"&&formError&&<p className="form-error" role="alert">{formError}</p>}
  </CrudModal>
    </article>

    <article className="detail-card form-span">
      <h2>{tr("Retention Policy", "سياسة الاحتفاظ")}</h2>
      <p className="muted">{tr("Clinical results, diagnostic reports and audit history are forced to RETAIN_ONLY. In-app purge is limited to expired/revoked authentication sessions.", "النتائج السريرية والتقارير التشخيصية وسجل التدقيق مجبرة على RETAIN_ONLY. الحذف داخل النظام محدود بجلسات المصادقة المنتهية أو الملغاة.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={()=>{setMessage("");setFormError("");setUiEditor("retention");}}>
    {tr("Configure Retention Policy","إعداد سياسة الاحتفاظ")}
  </button>
  <CrudModal open={uiEditor==="retention"} onClose={()=>{if(!busy)setUiEditor("");}}
    size="compact" title={tr("Configure Retention Policy","إعداد سياسة الاحتفاظ")}
    description={tr("Clinical results/reports and audit history remain permanently protected from in-app purge.","تبقى النتائج والتقارير السريرية وسجلات التدقيق محمية من الحذف داخل النظام.")}>
    {uiEditor==="retention"&&<form className="catalog-form" onSubmit={retention}>
        <label>{tr("Data class", "فئة البيانات")}<select name="dataClass">
          {["ANALYZER_MESSAGES","INTEGRATION_MESSAGES","WEBHOOK_DELIVERIES","PORTAL_SESSIONS","USER_SESSIONS","AUDIT_EVENTS","CLINICAL_RESULTS","DIAGNOSTIC_REPORTS"].map(v=><option key={v} value={v}>{dataClassLabel(v)}</option>)}
        </select></label>
        <label>{tr("Action", "الإجراء")}<select name="action" defaultValue="RETAIN_ONLY"><option value="RETAIN_ONLY">{actionLabel("RETAIN_ONLY")}</option><option value="ARCHIVE">{actionLabel("ARCHIVE")}</option><option value="PURGE">{actionLabel("PURGE")}</option></select></label>
        <label>{tr("Retain days", "أيام الاحتفاظ")}<input name="retainDays" type="number" min="30" /></label>
        <label>{tr("Archive after days", "الأرشفة بعد عدد أيام")}<input name="archiveAfterDays" type="number" min="30" /></label>
        <label className="check-row"><input type="checkbox" name="enabled" /> {tr("Enabled", "مفعلة")}</label>
        <label>{tr("Notes", "ملاحظات")}<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="retention"}>{busy==="retention"?tr("Saving…", "جارٍ الحفظ…"):tr("Save retention policy", "حفظ سياسة الاحتفاظ")}</button>
      </form>}
    {uiEditor==="retention"&&formError&&<p className="form-error" role="alert">{formError}</p>}
  </CrudModal>
      {retentionPolicies.length > 0 && <div className="retention-actions">
        {retentionPolicies.map(policy=><div key={policy.id}>
          <span><strong>{dataClassLabel(policy.dataClass)}</strong> · {actionLabel(policy.action)} · {policy.enabled?tr("enabled", "مفعلة"):tr("disabled", "معطلة")}</span>
          <div>
            <button className="secondary-button" type="button" onClick={()=>void preview(policy)} disabled={busy==="preview-"+policy.id}>{tr("Preview", "معاينة")}</button>
            {canArchive && policy.action==="PURGE" && ["USER_SESSIONS","PORTAL_SESSIONS"].includes(policy.dataClass) &&
              <button className="danger-button" type="button" onClick={()=>openPurge(policy)} disabled={busy==="purge-"+policy.id}>{tr("Purge expired sessions", "حذف الجلسات المنتهية")}</button>}
          </div>
        </div>)}
      </div>}
    </article>

    {message && <p className="form-success form-span" role="status">{message}</p>}
    <CrudModal open={purgePolicy!==null} onClose={()=>{if(!busy)setPurgePolicy(null);}}
      size="compact"
      title={tr("Purge Expired Authentication Sessions","حذف جلسات المصادقة المنتهية")}
      description={tr(
        "This action can delete only expired or revoked sessions accepted by server policy. Audit events, clinical results and reports are not eligible for purge.",
        "لا يمكن لهذا الإجراء حذف سوى الجلسات المنتهية أو الملغاة التي تسمح بها سياسة السيرفر. سجلات التدقيق والنتائج والتقارير السريرية غير مؤهلة للحذف.",
      )}>
      {purgePolicy&&<form className="catalog-form" onSubmit={purge}>
        <div className="form-span">
          <strong>{dataClassLabel(purgePolicy.dataClass)}</strong>
          <p>{tr("Retention period","مدة الاحتفاظ")}: {purgePolicy.retainDays??"—"} {tr("days","يوماً")}</p>
          <p>{tr("Preview the candidates and verify the exact retention policy before confirming.",
            "عاين السجلات المرشحة وتحقق من سياسة الاحتفاظ المحددة قبل التأكيد.")}</p>
        </div>
        {formError&&<p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="danger-button form-span" disabled={Boolean(busy)}>
          {tr("Confirm expired-session purge","تأكيد حذف الجلسات المنتهية")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
