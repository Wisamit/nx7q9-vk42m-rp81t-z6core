"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
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
}: {
  branches: Branch[];
  retentionPolicies: RetentionPolicy[];
  canManage: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function send(name: string, url: string, body: unknown) {
    setBusy(name); setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setMessage(data.error || "Operation failed.");
      return data;
    }
    setMessage("Saved successfully.");
    router.refresh();
    return data;
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
    setBusy("preview-" + policy.id); setMessage("");
    const response = await fetch("/api/resilience/retention/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataClass: policy.dataClass }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok
      ? `${policy.dataClass}: ${data.candidateCount ?? 0} candidate(s). ${data.executable ? "In-app purge is permitted for expired/revoked sessions only." : data.note || "No in-app destructive action permitted."}`
      : data.error || "Preview failed.");
  }

  async function purge(policy: RetentionPolicy) {
    if (!confirm("Purge only expired/revoked authentication sessions matching this policy?")) return;
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
      <h2>Branch Continuity</h2>
      <p className="muted">Offline clinical writes remain disabled. BUFFER_NON_CLINICAL is limited to explicitly allowed operational events.</p>
      <form className="catalog-form" onSubmit={continuity}>
        <label>Branch<select name="branchId" required>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.nameEn}</option>)}</select></label>
        <label>Mode<select name="mode" defaultValue="CENTRAL_ONLY"><option>CENTRAL_ONLY</option><option>READ_ONLY_CACHE</option><option>BUFFER_NON_CLINICAL</option></select></label>
        <label>Local buffer minutes<input name="localBufferMinutes" type="number" min="1" max="1440" /></label>
        <label className="form-span">Notes<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="continuity"}>{busy==="continuity"?"Saving…":"Save continuity policy"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Register Edge Node</h2>
      <p className="muted">Requires the selected branch to use BUFFER_NON_CLINICAL mode.</p>
      <form className="catalog-form" onSubmit={edgeNode}>
        <label>Branch<select name="branchId" required>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.nameEn}</option>)}</select></label>
        <label>Code<input name="code" required placeholder="ALAIN-EDGE-01" /></label>
        <label>Name<input name="name" required /></label>
        <label>Software version<input name="softwareVersion" /></label>
        <button className="primary-button form-span" disabled={busy==="edge"}>{busy==="edge"?"Saving…":"Register edge node"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Backup Evidence</h2>
      <p className="muted">Records evidence from the actual database/file backup system; this does not claim that the LIS itself created the backup.</p>
      <form className="catalog-form" onSubmit={backup}>
        <label>Scope<select name="branchId"><option value="">Organization-wide</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.nameEn}</option>)}</select></label>
        <label>Provider<input name="provider" required placeholder="DB provider / object storage" /></label>
        <label className="form-span">Backup reference<input name="backupReference" required /></label>
        <label>Backup created<input name="backupCreatedAt" type="datetime-local" required /></label>
        <label>Status<select name="status" defaultValue="RECORDED"><option>RECORDED</option><option>VERIFIED</option><option>FAILED</option></select></label>
        <label>Restore tested<input name="restoreTestedAt" type="datetime-local" /></label>
        <label>Restore duration (min)<input name="restoreDurationMinutes" type="number" min="0" /></label>
        <label className="form-span">Evidence reference<input name="evidenceReference" /></label>
        <label className="form-span">Notes<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="backup"}>{busy==="backup"?"Saving…":"Record backup evidence"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Disaster Recovery Drill</h2>
      <form className="catalog-form" onSubmit={drill}>
        <label>Scope<select name="branchId"><option value="">Organization-wide</option>{branches.map(b=><option key={b.id} value={b.id}>{b.code} — {b.nameEn}</option>)}</select></label>
        <label>Title<input name="title" required /></label>
        <label>Status<select name="status" defaultValue="PLANNED"><option>PLANNED</option><option>IN_PROGRESS</option><option>PASSED</option><option>FAILED</option><option>CANCELLED</option></select></label>
        <label>Scheduled<input name="scheduledAt" type="datetime-local" required /></label>
        <label>Target RPO min<input name="targetRpoMinutes" type="number" min="0" required /></label>
        <label>Target RTO min<input name="targetRtoMinutes" type="number" min="0" required /></label>
        <label>Actual RPO min<input name="actualRpoMinutes" type="number" min="0" /></label>
        <label>Actual RTO min<input name="actualRtoMinutes" type="number" min="0" /></label>
        <label>Completed<input name="completedAt" type="datetime-local" /></label>
        <label>Evidence<input name="evidenceReference" /></label>
        <label className="form-span">Findings<input name="findings" /></label>
        <label className="form-span">Corrective actions<input name="correctiveActions" /></label>
        <button className="primary-button form-span" disabled={busy==="drill"}>{busy==="drill"?"Saving…":"Record DR drill"}</button>
      </form>
    </article>

    <article className="detail-card form-span">
      <h2>Retention Policy</h2>
      <p className="muted">Clinical results, diagnostic reports and audit history are forced to RETAIN_ONLY. In-app purge is limited to expired/revoked authentication sessions.</p>
      <form className="catalog-form" onSubmit={retention}>
        <label>Data class<select name="dataClass">
          {["ANALYZER_MESSAGES","INTEGRATION_MESSAGES","WEBHOOK_DELIVERIES","PORTAL_SESSIONS","USER_SESSIONS","AUDIT_EVENTS","CLINICAL_RESULTS","DIAGNOSTIC_REPORTS"].map(v=><option key={v}>{v}</option>)}
        </select></label>
        <label>Action<select name="action" defaultValue="RETAIN_ONLY"><option>RETAIN_ONLY</option><option>ARCHIVE</option><option>PURGE</option></select></label>
        <label>Retain days<input name="retainDays" type="number" min="30" /></label>
        <label>Archive after days<input name="archiveAfterDays" type="number" min="30" /></label>
        <label className="check-row"><input type="checkbox" name="enabled" /> Enabled</label>
        <label>Notes<input name="notes" /></label>
        <button className="primary-button form-span" disabled={busy==="retention"}>{busy==="retention"?"Saving…":"Save retention policy"}</button>
      </form>
      {retentionPolicies.length > 0 && <div className="retention-actions">
        {retentionPolicies.map(policy=><div key={policy.id}>
          <span><strong>{policy.dataClass}</strong> · {policy.action} · {policy.enabled?"enabled":"disabled"}</span>
          <div>
            <button className="secondary-button" type="button" onClick={()=>void preview(policy)} disabled={busy==="preview-"+policy.id}>Preview</button>
            {canArchive && policy.action==="PURGE" && ["USER_SESSIONS","PORTAL_SESSIONS"].includes(policy.dataClass) &&
              <button className="danger-button" type="button" onClick={()=>void purge(policy)} disabled={busy==="purge-"+policy.id}>Purge expired sessions</button>}
          </div>
        </div>)}
      </div>}
    </article>

    {message && <p className="form-success form-span">{message}</p>}
  </section>;
}
