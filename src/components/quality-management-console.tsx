"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type UserOption = { id: string; username: string; displayNameEn: string };
type Analyzer = { id: string; code: string; name: string; branchId: string };
type PermissionFlags = {
  nonconformance: boolean;
  capa: boolean;
  documents: boolean;
  training: boolean;
  indicators: boolean;
  audits: boolean;
};

type Nonconformance = {
  id: string;
  caseNumber: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  branch: string;
  detectedAt: string;
  owner: string | null;
  rootCause: string | null;
  closureSummary: string | null;
  capas: Array<{ id: string; capaNumber: string; status: string }>;
};

type Capa = {
  id: string;
  capaNumber: string;
  title: string;
  status: string;
  branch: string;
  owner: string;
  dueDate: string | null;
  effectiveness: string;
  nonconformanceCase: string | null;
  actions: Array<{
    id: string;
    actionType: string;
    description: string;
    status: string;
    owner: string | null;
    dueDate: string | null;
  }>;
};

type QualityDocument = {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  documentType: string;
  branch: string;
  currentEffectiveVersion: number;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    changeSummary: string | null;
    effectiveFrom: string | null;
    reviewDueAt: string | null;
    externalUrl: string | null;
  }>;
};

type TrainingRecord = {
  id: string;
  user: string;
  title: string;
  status: string;
  analyzer: string | null;
  document: string | null;
  assignedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

type Competency = {
  id: string;
  user: string;
  competencyName: string;
  result: string;
  analyzer: string | null;
  assessedAt: string;
  nextDueAt: string | null;
  assessor: string;
};

type Authorization = {
  id: string;
  user: string;
  analyzer: string;
  status: string;
  authorizedAt: string;
  expiresAt: string | null;
  approvedBy: string;
};

type Indicator = {
  id: string;
  code: string;
  nameEn: string;
  branch: string;
  direction: string;
  unit: string | null;
  targetMin: string | null;
  targetMax: string | null;
  measurements: Array<{ id: string; periodStart: string; periodEnd: string; value: string }>;
};

type InternalAudit = {
  id: string;
  auditNumber: string;
  title: string;
  scope: string;
  status: string;
  branch: string;
  scheduledAt: string;
  leadAuditor: string;
  findings: Array<{
    id: string;
    findingNumber: string;
    severity: string;
    description: string;
    status: string;
    owner: string | null;
    dueDate: string | null;
    capaNumber: string | null;
  }>;
};

export function QualityManagementConsole({
  permissions,
  branches,
  users,
  analyzers,
  nonconformances,
  capas,
  documents,
  trainingRecords,
  competencies,
  authorizations,
  effectiveDocumentVersions,
  indicators,
  audits,
}: {
  permissions: PermissionFlags;
  branches: Branch[];
  users: UserOption[];
  analyzers: Analyzer[];
  nonconformances: Nonconformance[];
  capas: Capa[];
  documents: QualityDocument[];
  trainingRecords: TrainingRecord[];
  competencies: Competency[];
  authorizations: Authorization[];
  effectiveDocumentVersions: Array<{ id: string; label: string }>;
  indicators: Indicator[];
  audits: InternalAudit[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [trainingAnalyzerId, setTrainingAnalyzerId] = useState("");
  const [competencyAnalyzerId, setCompetencyAnalyzerId] = useState("");

  const openNonconformances = useMemo(
    () => nonconformances.filter(item => !["CLOSED","CANCELLED"].includes(item.status)),
    [nonconformances],
  );
  const openCapas = useMemo(
    () => capas.filter(item => !["CLOSED","CANCELLED"].includes(item.status)),
    [capas],
  );

  async function send(url: string, method: "POST" | "PATCH", payload: unknown, key: string, success: string) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Action failed.");
    if (response.ok) router.refresh();
    return response.ok;
  }

  async function createNonconformance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/nonconformances", "POST", {
      branchId: form.get("branchId"),
      title: form.get("title"),
      description: form.get("description"),
      category: form.get("category"),
      severity: form.get("severity"),
      occurredAt: form.get("occurredAt"),
      ownerUserId: form.get("ownerUserId"),
      immediateAction: form.get("immediateAction"),
      sourceEntityType: form.get("sourceEntityType"),
      sourceEntityId: form.get("sourceEntityId"),
    }, "nc-create", "Nonconformance recorded.");
    if (ok) event.currentTarget.reset();
  }

  async function updateNonconformance(item: Nonconformance, close: boolean) {
    let rootCause = item.rootCause || "";
    let closureSummary = item.closureSummary || "";
    if (close) {
      rootCause = window.prompt("Root cause is required before closure:", rootCause) || "";
      if (!rootCause.trim()) return;
      closureSummary = window.prompt("Closure summary is required:", closureSummary) || "";
      if (!closureSummary.trim()) return;
      if (!window.confirm("Close this nonconformance? The closure will remain in audit history.")) return;
    }
    await send(`/api/quality/nonconformances/${item.id}`, "PATCH", {
      status: close ? "CLOSED" : "INVESTIGATING",
      rootCause,
      closureSummary,
    }, "nc-" + item.id, close ? "Nonconformance closed." : "Nonconformance moved to investigation.");
  }

  async function createCapa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/capas", "POST", {
      branchId: form.get("branchId"),
      nonconformanceId: form.get("nonconformanceId"),
      title: form.get("title"),
      issueDescription: form.get("issueDescription"),
      rootCause: form.get("rootCause"),
      ownerUserId: form.get("ownerUserId"),
      dueDate: form.get("dueDate"),
    }, "capa-create", "CAPA created.");
    if (ok) event.currentTarget.reset();
  }

  async function addCapaAction(capa: Capa) {
    const actionType = window.confirm("OK = corrective action. Cancel = preventive action.") ? "CORRECTIVE" : "PREVENTIVE";
    const description = window.prompt(`Describe the ${actionType.toLowerCase()} action:`);
    if (!description?.trim()) return;
    const dueDate = window.prompt("Due date (YYYY-MM-DD), optional:") || "";
    await send(`/api/quality/capas/${capa.id}/actions`, "POST", {
      actionType,
      description,
      dueDate,
    }, "capa-action-" + capa.id, "CAPA action added.");
  }

  async function completeCapaAction(capaId: string, actionId: string) {
    if (!window.confirm("Mark this CAPA action as completed?")) return;
    await send(`/api/quality/capas/${capaId}/actions`, "PATCH", {
      actionId,
      status: "COMPLETED",
    }, "capa-action-" + actionId, "CAPA action completed.");
  }

  async function reviewCapa(capa: Capa) {
    const effectiveness = window.prompt("Effectiveness: EFFECTIVE, PARTIALLY_EFFECTIVE, or INEFFECTIVE", "EFFECTIVE")?.trim().toUpperCase();
    if (!effectiveness || !["EFFECTIVE","PARTIALLY_EFFECTIVE","INEFFECTIVE"].includes(effectiveness)) return;
    const effectivenessReview = window.prompt("Document the effectiveness review:");
    if (!effectivenessReview?.trim()) return;
    const close = effectiveness === "EFFECTIVE" && window.confirm("Close this CAPA after the effectiveness review?");
    await send(`/api/quality/capas/${capa.id}/review`, "POST", {
      effectiveness,
      effectivenessReview,
      close,
    }, "capa-review-" + capa.id, close ? "CAPA reviewed and closed." : "CAPA effectiveness review recorded.");
  }

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const content = String(form.get("content") || "").trim();
    const ok = await send("/api/quality/documents", "POST", {
      branchId: form.get("branchId"),
      code: form.get("code"),
      titleEn: form.get("titleEn"),
      titleAr: form.get("titleAr"),
      documentType: form.get("documentType"),
      ownerUserId: form.get("ownerUserId"),
      externalUrl: form.get("externalUrl"),
      reviewDueAt: form.get("reviewDueAt"),
      contentSnapshot: content ? { text: content } : null,
      changeSummary: "Initial version",
    }, "document-create", "Controlled document created as version 1 draft.");
    if (ok) event.currentTarget.reset();
  }

  async function newDocumentVersion(document: QualityDocument) {
    const changeSummary = window.prompt("Change summary for the new version:");
    if (!changeSummary?.trim()) return;
    const content = window.prompt("Document text/content snapshot (or leave empty if you will provide an external URL):") || "";
    const externalUrl = content ? "" : window.prompt("External document URL:") || "";
    if (!content.trim() && !externalUrl.trim()) return;
    await send(`/api/quality/documents/${document.id}/versions`, "POST", {
      changeSummary,
      contentSnapshot: content.trim() ? { text: content } : null,
      externalUrl,
    }, "doc-new-" + document.id, "New immutable document version created.");
  }

  async function documentWorkflow(versionId: string, action: "SUBMIT_REVIEW" | "COMPLETE_REVIEW" | "APPROVE" | "MAKE_EFFECTIVE") {
    const label = action === "SUBMIT_REVIEW"
      ? "submit for review"
      : action === "COMPLETE_REVIEW"
        ? "complete review"
        : action === "APPROVE"
          ? "approve"
          : "make effective";
    if (!window.confirm(`Confirm: ${label} this document version?`)) return;
    await send(`/api/quality/document-versions/${versionId}/workflow`, "POST", { action }, "doc-workflow-" + versionId, `Document version action completed: ${label}.`);
  }

  async function createTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/training", "POST", {
      branchId: form.get("branchId"),
      userId: form.get("userId"),
      title: form.get("title"),
      provider: form.get("provider"),
      documentVersionId: form.get("documentVersionId"),
      analyzerId: form.get("analyzerId"),
      status: form.get("status"),
      assignedAt: form.get("assignedAt"),
      completedAt: form.get("completedAt"),
      expiresAt: form.get("expiresAt"),
      certificateUrl: form.get("certificateUrl"),
      notes: form.get("notes"),
    }, "training-create", "Training record saved.");
    if (ok) {
      event.currentTarget.reset();
      setTrainingAnalyzerId("");
    }
  }

  async function createCompetency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/competency", "POST", {
      branchId: form.get("branchId"),
      userId: form.get("userId"),
      analyzerId: form.get("analyzerId"),
      documentVersionId: form.get("documentVersionId"),
      competencyName: form.get("competencyName"),
      assessmentMethod: form.get("assessmentMethod"),
      result: form.get("result"),
      assessedAt: form.get("assessedAt"),
      nextDueAt: form.get("nextDueAt"),
      notes: form.get("notes"),
    }, "competency-create", "Competency assessment recorded.");
    if (ok) {
      event.currentTarget.reset();
      setCompetencyAnalyzerId("");
    }
  }

  async function grantAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/analyzer-authorizations", "POST", {
      userId: form.get("userId"),
      analyzerId: form.get("analyzerId"),
      expiresAt: form.get("expiresAt"),
      scopeNotes: form.get("scopeNotes"),
    }, "authorization-create", "Analyzer authorization granted.");
    if (ok) event.currentTarget.reset();
  }

  async function revokeAuthorization(item: Authorization) {
    const reason = window.prompt("Reason for revocation:");
    if (!reason?.trim()) return;
    if (!window.confirm("Revoke this analyzer authorization?")) return;
    await send("/api/quality/analyzer-authorizations", "PATCH", {
      id: item.id,
      status: "REVOKED",
      revocationReason: reason,
    }, "auth-" + item.id, "Analyzer authorization revoked.");
  }

  async function createIndicator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/indicators", "POST", {
      branchId: form.get("branchId"),
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      unit: form.get("unit"),
      direction: form.get("direction"),
      targetMin: form.get("targetMin"),
      targetMax: form.get("targetMax"),
      description: form.get("description"),
    }, "indicator-create", "Quality indicator created.");
    if (ok) event.currentTarget.reset();
  }

  async function addMeasurement(indicator: Indicator) {
    const periodStart = window.prompt("Period start (YYYY-MM-DD):");
    if (!periodStart) return;
    const periodEnd = window.prompt("Period end (YYYY-MM-DD):");
    if (!periodEnd) return;
    const value = window.prompt(`Measured value${indicator.unit ? " (" + indicator.unit + ")" : ""}:`);
    if (!value) return;
    const numerator = window.prompt("Numerator (optional):") || "";
    const denominator = window.prompt("Denominator (optional):") || "";
    await send(`/api/quality/indicators/${indicator.id}/measurements`, "POST", {
      periodStart,
      periodEnd,
      value,
      numerator,
      denominator,
    }, "indicator-measure-" + indicator.id, "Indicator measurement recorded.");
  }

  async function createAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/quality/audits", "POST", {
      branchId: form.get("branchId"),
      title: form.get("title"),
      scope: form.get("scope"),
      scheduledAt: form.get("scheduledAt"),
      leadAuditorUserId: form.get("leadAuditorUserId"),
    }, "audit-create", "Internal audit planned.");
    if (ok) event.currentTarget.reset();
  }

  async function addFinding(audit: InternalAudit) {
    const severity = window.prompt("Severity: OBSERVATION, MINOR, MAJOR, CRITICAL", "MINOR")?.trim().toUpperCase();
    if (!severity || !["OBSERVATION","MINOR","MAJOR","CRITICAL"].includes(severity)) return;
    const description = window.prompt("Finding description:");
    if (!description?.trim()) return;
    const requirementRef = window.prompt("Requirement / SOP / clause reference (optional):") || "";
    let capaId = "";
    if (severity === "CRITICAL") {
      const capaNumber = window.prompt("Critical findings require a linked open CAPA. Enter CAPA number:");
      const capa = openCapas.find(item => item.capaNumber.toUpperCase() === capaNumber?.trim().toUpperCase());
      if (!capa) {
        setMessage("Critical finding was not saved: select an existing open CAPA first.");
        return;
      }
      capaId = capa.id;
    } else {
      const capaNumber = window.prompt("Link an open CAPA number (optional):")?.trim();
      if (capaNumber) {
        const capa = openCapas.find(item => item.capaNumber.toUpperCase() === capaNumber.toUpperCase());
        if (!capa) {
          setMessage("CAPA number not found among open CAPA records.");
          return;
        }
        capaId = capa.id;
      }
    }
    await send(`/api/quality/audits/${audit.id}/findings`, "POST", {
      severity,
      description,
      requirementRef,
      capaId,
    }, "finding-create-" + audit.id, "Audit finding recorded.");
  }

  async function closeFinding(auditId: string, findingId: string) {
    const closureNote = window.prompt("Finding closure note:");
    if (!closureNote?.trim()) return;
    await send(`/api/quality/audits/${auditId}/findings`, "PATCH", {
      findingId,
      closureNote,
    }, "finding-close-" + findingId, "Audit finding closed.");
  }

  async function completeAudit(audit: InternalAudit) {
    const summary = window.prompt("Audit completion summary:");
    if (!summary?.trim()) return;
    if (!window.confirm("Complete this internal audit? All findings must already be closed.")) return;
    await send(`/api/quality/audits/${audit.id}/complete`, "POST", { summary }, "audit-complete-" + audit.id, "Internal audit completed.");
  }

  return <div className="detail-section">
    {message && <div className="form-success">{message}</div>}

    {permissions.nonconformance && <section className="detail-card detail-section">
      <h2>Record Nonconformance</h2>
      <form className="catalog-form" onSubmit={createNonconformance}>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Severity<select name="severity" defaultValue="MINOR"><option value="MINOR">Minor</option><option value="MAJOR">Major</option><option value="CRITICAL">Critical</option></select></label>
        <label>Category<input name="category" required placeholder="Pre-analytical / Analytical / Post-analytical / Safety…" /></label>
        <label>Owner<select name="ownerUserId" defaultValue=""><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
        <label className="form-span">Title<input name="title" required /></label>
        <label className="form-span">Description<textarea name="description" rows={3} required /></label>
        <label>Occurred at<input name="occurredAt" type="datetime-local" /></label>
        <label>Source type<input name="sourceEntityType" placeholder="Specimen / Result / Equipment…" /></label>
        <label>Source ID<input name="sourceEntityId" /></label>
        <label className="form-span">Immediate action<textarea name="immediateAction" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "nc-create" ? "Saving…" : "Record Nonconformance"}</button>
      </form>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Nonconformance Register</h2><span>{nonconformances.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Case</th><th>Title</th><th>Branch</th><th>Severity</th><th>Status</th><th>Owner</th><th>Detected</th><th>CAPA</th><th>Actions</th></tr></thead>
        <tbody>{nonconformances.length === 0 ? <tr><td colSpan={9} className="empty-state">No nonconformances recorded.</td></tr> : nonconformances.map(item => <tr key={item.id}>
          <td><strong>{item.caseNumber}</strong><br/><small>{item.category}</small></td>
          <td>{item.title}</td><td>{item.branch}</td><td>{item.severity}</td><td>{item.status}</td><td>{item.owner || "—"}</td>
          <td>{item.detectedAt.replace("T"," ").slice(0,16)}</td>
          <td>{item.capas.map(capa => capa.capaNumber).join(", ") || "—"}</td>
          <td>{permissions.nonconformance && !["CLOSED","CANCELLED"].includes(item.status) && <div className="result-actions">
            <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void updateNonconformance(item,false)}>Investigate</button>
            <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void updateNonconformance(item,true)}>Close</button>
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.capa && <section className="detail-card detail-section">
      <h2>Create CAPA</h2>
      <form className="catalog-form" onSubmit={createCapa}>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Linked nonconformance<select name="nonconformanceId" defaultValue=""><option value="">None</option>{openNonconformances.map(item => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}</select></label>
        <label>Owner<select name="ownerUserId" required defaultValue=""><option value="">Select owner…</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
        <label>Due date<input name="dueDate" type="date" /></label>
        <label className="form-span">Title<input name="title" required /></label>
        <label className="form-span">Issue description<textarea name="issueDescription" rows={3} required /></label>
        <label className="form-span">Root cause<textarea name="rootCause" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "capa-create" ? "Saving…" : "Create CAPA"}</button>
      </form>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>CAPA Register</h2><span>{capas.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>CAPA</th><th>Title</th><th>Owner</th><th>Status</th><th>Due</th><th>Effectiveness</th><th>Actions</th><th>Controls</th></tr></thead>
        <tbody>{capas.length === 0 ? <tr><td colSpan={8} className="empty-state">No CAPA records.</td></tr> : capas.map(item => <tr key={item.id}>
          <td><strong>{item.capaNumber}</strong>{item.nonconformanceCase && <><br/><small>{item.nonconformanceCase}</small></>}</td>
          <td>{item.title}<br/><small>{item.branch}</small></td><td>{item.owner}</td><td>{item.status}</td><td>{item.dueDate?.slice(0,10) || "—"}</td><td>{item.effectiveness}</td>
          <td>{item.actions.length === 0 ? "—" : item.actions.map(action => <div key={action.id}><small>{action.actionType} · {action.status} · {action.description}</small>{permissions.capa && action.status !== "COMPLETED" && action.status !== "CANCELLED" && <button type="button" className="table-action" onClick={() => void completeCapaAction(item.id,action.id)}>Complete</button>}</div>)}</td>
          <td>{permissions.capa && !["CLOSED","CANCELLED"].includes(item.status) && <div className="result-actions"><button type="button" className="secondary-button" onClick={() => void addCapaAction(item)}>Add Action</button><button type="button" className="secondary-button" onClick={() => void reviewCapa(item)}>Review</button></div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.documents && <section className="detail-card detail-section">
      <h2>Create Controlled Document</h2>
      <form className="catalog-form" onSubmit={createDocument}>
        <label>Code<input name="code" required placeholder="SOP-HEM-001" /></label>
        <label>Type<select name="documentType" defaultValue="SOP"><option value="SOP">SOP</option><option value="POLICY">Policy</option><option value="WORK_INSTRUCTION">Work instruction</option><option value="FORM">Form</option><option value="CHECKLIST">Checklist</option><option value="OTHER">Other</option></select></label>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
        <label>Owner<select name="ownerUserId" defaultValue=""><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
        <label>Title (English)<input name="titleEn" required /></label>
        <label dir="rtl">العنوان بالعربية<input name="titleAr" dir="rtl" /></label>
        <label>Review due<input name="reviewDueAt" type="date" /></label>
        <label>External URL<input name="externalUrl" type="url" /></label>
        <label className="form-span">Document content snapshot<textarea name="content" rows={5} placeholder="Controlled text content, or leave empty when using an external document URL." /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "document-create" ? "Saving…" : "Create Draft v1"}</button>
      </form>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Controlled Documents</h2><span>{documents.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Document</th><th>Branch</th><th>Effective</th><th>Latest versions</th><th>Controls</th></tr></thead>
        <tbody>{documents.length === 0 ? <tr><td colSpan={5} className="empty-state">No controlled documents.</td></tr> : documents.map(document => {
          const latest = document.versions[0];
          return <tr key={document.id}>
            <td><strong>{document.code}</strong><br/><small>{document.documentType} · {document.titleEn}</small></td>
            <td>{document.branch}</td><td>{document.currentEffectiveVersion ? "v" + document.currentEffectiveVersion : "None"}</td>
            <td>{document.versions.slice(0,4).map(version => <div key={version.id}><small>v{version.version} · {version.status}{version.reviewDueAt ? " · review " + version.reviewDueAt.slice(0,10) : ""}</small></div>)}</td>
            <td>{permissions.documents && latest && <div className="result-actions">
              {latest.status === "DRAFT" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"SUBMIT_REVIEW")}>Submit Review</button>}
              {latest.status === "IN_REVIEW" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"COMPLETE_REVIEW")}>Complete Review</button>}
              {latest.status === "REVIEWED" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"APPROVE")}>Approve</button>}
              {latest.status === "APPROVED" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"MAKE_EFFECTIVE")}>Make Effective</button>}
              {["EFFECTIVE","RETIRED"].includes(latest.status) && <button type="button" className="secondary-button" onClick={() => void newDocumentVersion(document)}>New Version</button>}
            </div>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    {permissions.training && <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>Training Record</h2>
        <form className="catalog-form" onSubmit={createTraining}>
          <label>User<select name="userId" required defaultValue=""><option value="">Select user…</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
          <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
          <label className="form-span">Training title<input name="title" required /></label>
          <label>Provider<input name="provider" /></label>
          <label>SOP/document<select name="documentVersionId" defaultValue=""><option value="">None</option>{effectiveDocumentVersions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Analyzer<select name="analyzerId" value={trainingAnalyzerId} onChange={event => setTrainingAnalyzerId(event.target.value)}><option value="">None</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>Status<select name="status" defaultValue="ASSIGNED"><option value="ASSIGNED">Assigned</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="WAIVED">Waived</option></select></label>
          <label>Assigned at<input name="assignedAt" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></label>
          <label>Completed at<input name="completedAt" type="date" /></label>
          <label>Expires<input name="expiresAt" type="date" /></label>
          <label className="form-span">Certificate URL<input name="certificateUrl" type="url" /></label>
          <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "training-create" ? "Saving…" : "Save Training Record"}</button>
        </form>
      </article>

      <article className="detail-card">
        <h2>Competency Assessment</h2>
        <form className="catalog-form" onSubmit={createCompetency}>
          <label>User<select name="userId" required defaultValue=""><option value="">Select user…</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
          <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
          <label>Analyzer<select name="analyzerId" value={competencyAnalyzerId} onChange={event => setCompetencyAnalyzerId(event.target.value)}><option value="">None</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>SOP/document<select name="documentVersionId" defaultValue=""><option value="">None</option>{effectiveDocumentVersions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Competency<input name="competencyName" required /></label>
          <label>Assessment method<input name="assessmentMethod" required placeholder="Direct observation / blind sample / quiz…" /></label>
          <label>Result<select name="result" defaultValue="PASS"><option value="PASS">Pass</option><option value="CONDITIONAL">Conditional</option><option value="FAIL">Fail</option></select></label>
          <label>Assessed at<input name="assessedAt" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></label>
          <label>Next due<input name="nextDueAt" type="date" /></label>
          <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "competency-create" ? "Saving…" : "Record Competency"}</button>
        </form>
      </article>

      <article className="detail-card">
        <h2>Analyzer Authorization</h2>
        <p className="muted">An active, current PASS competency assessment for the same analyzer is mandatory before authorization.</p>
        <form className="catalog-form" onSubmit={grantAuthorization}>
          <label>User<select name="userId" required defaultValue=""><option value="">Select user…</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
          <label>Analyzer<select name="analyzerId" required defaultValue=""><option value="">Select analyzer…</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>Expires<input name="expiresAt" type="date" /></label>
          <label className="form-span">Scope notes<textarea name="scopeNotes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "authorization-create" ? "Saving…" : "Grant Authorization"}</button>
        </form>
      </article>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Training & Competency</h2><span>{trainingRecords.length} training · {competencies.length} assessments</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>User</th><th>Training</th><th>Status</th><th>Analyzer / Document</th><th>Dates</th></tr></thead>
        <tbody>{trainingRecords.length === 0 ? <tr><td colSpan={5} className="empty-state">No training records.</td></tr> : trainingRecords.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.title}</td><td>{item.status}</td><td>{item.analyzer || item.document || "—"}</td><td>{item.assignedAt.slice(0,10)}{item.expiresAt ? " → " + item.expiresAt.slice(0,10) : ""}</td></tr>)}</tbody>
      </table></div>
      <div className="table-wrap"><table>
        <thead><tr><th>User</th><th>Competency</th><th>Analyzer</th><th>Result</th><th>Assessed</th><th>Next due</th></tr></thead>
        <tbody>{competencies.length === 0 ? <tr><td colSpan={6} className="empty-state">No competency assessments.</td></tr> : competencies.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.competencyName}</td><td>{item.analyzer || "—"}</td><td>{item.result}</td><td>{item.assessedAt.slice(0,10)}</td><td>{item.nextDueAt?.slice(0,10) || "—"}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Analyzer Authorizations</h2><span>{authorizations.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>User</th><th>Analyzer</th><th>Status</th><th>Authorized</th><th>Expires</th><th>Approved by</th><th>Action</th></tr></thead>
        <tbody>{authorizations.length === 0 ? <tr><td colSpan={7} className="empty-state">No analyzer authorizations.</td></tr> : authorizations.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.analyzer}</td><td>{item.status}</td><td>{item.authorizedAt.slice(0,10)}</td><td>{item.expiresAt?.slice(0,10) || "—"}</td><td>{item.approvedBy}</td><td>{permissions.training && item.status === "ACTIVE" && <button type="button" className="secondary-button" onClick={() => void revokeAuthorization(item)}>Revoke</button>}</td></tr>)}</tbody>
      </table></div>
    </section>

    {permissions.indicators && <section className="detail-card detail-section">
      <h2>Quality Indicator</h2>
      <form className="catalog-form" onSubmit={createIndicator}>
        <label>Code<input name="code" required /></label>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>Direction<select name="direction" defaultValue="LOWER_IS_BETTER"><option value="LOWER_IS_BETTER">Lower is better</option><option value="HIGHER_IS_BETTER">Higher is better</option><option value="TARGET_RANGE">Target range</option></select></label>
        <label>Unit<input name="unit" placeholder="% / min / count…" /></label>
        <label>Target min<input name="targetMin" inputMode="decimal" /></label>
        <label>Target max<input name="targetMax" inputMode="decimal" /></label>
        <label className="form-span">Description<textarea name="description" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "indicator-create" ? "Saving…" : "Create Indicator"}</button>
      </form>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Quality Indicators</h2><span>{indicators.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Indicator</th><th>Scope</th><th>Direction</th><th>Target</th><th>Latest value</th><th>Action</th></tr></thead>
        <tbody>{indicators.length === 0 ? <tr><td colSpan={6} className="empty-state">No quality indicators.</td></tr> : indicators.map(item => {
          const latest = item.measurements[0];
          const target = item.direction === "TARGET_RANGE" ? `${item.targetMin || "—"}–${item.targetMax || "—"}` : item.direction === "LOWER_IS_BETTER" ? `≤ ${item.targetMax || "—"}` : `≥ ${item.targetMin || "—"}`;
          return <tr key={item.id}><td><strong>{item.code}</strong><br/><small>{item.nameEn}</small></td><td>{item.branch}</td><td>{item.direction}</td><td>{target} {item.unit || ""}</td><td>{latest ? latest.value + " " + (item.unit || "") + " · " + latest.periodEnd.slice(0,10) : "—"}</td><td>{permissions.indicators && <button type="button" className="secondary-button" onClick={() => void addMeasurement(item)}>Add Measurement</button>}</td></tr>;
        })}</tbody>
      </table></div>
    </section>

    {permissions.audits && <section className="detail-card detail-section">
      <h2>Plan Internal Audit</h2>
      <form className="catalog-form" onSubmit={createAudit}>
        <label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
        <label>Lead auditor<select name="leadAuditorUserId" required defaultValue=""><option value="">Select auditor…</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayNameEn}</option>)}</select></label>
        <label>Scheduled date<input name="scheduledAt" type="date" required /></label>
        <label className="form-span">Title<input name="title" required /></label>
        <label className="form-span">Scope<textarea name="scope" rows={3} required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "audit-create" ? "Saving…" : "Plan Internal Audit"}</button>
      </form>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Internal Audits</h2><span>{audits.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Audit</th><th>Scope</th><th>Branch</th><th>Status</th><th>Lead</th><th>Scheduled</th><th>Findings</th><th>Controls</th></tr></thead>
        <tbody>{audits.length === 0 ? <tr><td colSpan={8} className="empty-state">No internal audits.</td></tr> : audits.map(audit => <tr key={audit.id}>
          <td><strong>{audit.auditNumber}</strong><br/><small>{audit.title}</small></td><td>{audit.scope}</td><td>{audit.branch}</td><td>{audit.status}</td><td>{audit.leadAuditor}</td><td>{audit.scheduledAt.slice(0,10)}</td>
          <td>{audit.findings.length === 0 ? "—" : audit.findings.map(finding => <div key={finding.id}><small>{finding.findingNumber} · {finding.severity} · {finding.status}{finding.capaNumber ? " · " + finding.capaNumber : ""}</small>{permissions.audits && finding.status !== "CLOSED" && <button type="button" className="table-action" onClick={() => void closeFinding(audit.id,finding.id)}>Close</button>}</div>)}</td>
          <td>{permissions.audits && !["COMPLETED","CANCELLED"].includes(audit.status) && <div className="result-actions"><button type="button" className="secondary-button" onClick={() => void addFinding(audit)}>Add Finding</button><button type="button" className="secondary-button" onClick={() => void completeAudit(audit)}>Complete</button></div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
