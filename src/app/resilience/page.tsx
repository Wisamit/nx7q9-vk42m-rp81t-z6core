import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ResilienceManager } from "@/components/resilience-manager";

export const dynamic = "force-dynamic";

function ageLabel(value: Date | null) {
  if (!value) return "No record";
  const ms = Date.now() - value.getTime();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

export default async function ResiliencePage() {
  const session = await requirePermission("resilience.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [
    branches,
    backups,
    drills,
    policies,
    edgeNodes,
    edgeQueueByStatus,
    integrationDeadLetters,
    webhookDeadLetters,
    analyzerDeadLetters,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      include: { continuityPolicy: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.backupVerification.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      include: { branch: true, recordedBy: true },
      orderBy: { backupCreatedAt: "desc" },
      take: 50,
    }),
    prisma.disasterRecoveryDrill.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      include: { branch: true, owner: true },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    }),
    prisma.retentionPolicy.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { dataClass: "asc" },
    }),
    prisma.edgeNode.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: { branch: true },
      orderBy: [{ branch: { nameEn: "asc" } }, { code: "asc" }],
    }),
    prisma.edgeQueueMessage.groupBy({
      by: ["status"],
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      _count: { _all: true },
    }),
    prisma.integrationMessage.count({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
        status: "DEAD_LETTER",
      },
    }),
    prisma.webhookDelivery.count({
      where: { organizationId: session.user.organizationId, status: "DEAD_LETTER" },
    }),
    prisma.analyzerMessage.count({
      where: { analyzer: { organizationId: session.user.organizationId, branchId: { in: branchIds } }, status: "DEAD_LETTER" },
    }),
  ]);

  const latestBackup = backups[0]?.backupCreatedAt || null;
  const latestVerifiedBackup = backups.find(item => item.status === "VERIFIED")?.backupCreatedAt || null;
  const failedDrills = drills.filter(item => item.status === "FAILED").length;
  const pendingEdge = edgeQueueByStatus
    .filter(item => ["QUEUED","RECEIVED","FAILED"].includes(item.status))
    .reduce((sum, item) => sum + item._count._all, 0);
  const edgeDeadLetters = edgeQueueByStatus.find(item => item.status === "DEAD_LETTER")?._count._all || 0;
  const totalDeadLetters = integrationDeadLetters + webhookDeadLetters + analyzerDeadLetters + edgeDeadLetters;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Resilience & Scale</p>
        <h1>Operational Resilience</h1>
        <p className="muted">Health, backup evidence, disaster recovery, safe retention, branch continuity and non-clinical edge buffering. Clinical history remains protected from destructive retention.</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>Latest backup</span><strong>{ageLabel(latestBackup)}</strong><small>Evidence recorded in LIS</small></article>
      <article><span>Verified backup</span><strong>{ageLabel(latestVerifiedBackup)}</strong><small>Restore evidence present</small></article>
      <article className={totalDeadLetters ? "summary-attention" : ""}><span>Dead letters</span><strong>{totalDeadLetters}</strong><small>Analyzer + integration + webhook + edge</small></article>
      <article className={failedDrills ? "summary-attention" : ""}><span>Failed DR drills</span><strong>{failedDrills}</strong><small>{pendingEdge} edge event(s) pending/review</small></article>
    </section>

    <section className="detail-grid">
      <article className="table-card">
        <div className="table-toolbar"><h2>Branch Continuity</h2><span>{branches.length} branch(es)</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Branch</th><th>Mode</th><th>Clinical offline writes</th><th>Buffer window</th></tr></thead>
          <tbody>{branches.map(branch => <tr key={branch.id}>
            <td><strong>{branch.code}</strong><br/><small>{branch.nameEn}</small></td>
            <td>{branch.continuityPolicy?.mode || "CENTRAL_ONLY"}</td>
            <td>{branch.continuityPolicy?.offlineClinicalWritesAllowed ? "ENABLED" : "DISABLED"}</td>
            <td>{branch.continuityPolicy?.localBufferMinutes ? branch.continuityPolicy.localBufferMinutes + " min" : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Edge Nodes</h2><span>{edgeNodes.length} node(s)</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Node</th><th>Branch</th><th>Status</th><th>Heartbeat</th><th>Last sync</th></tr></thead>
          <tbody>{edgeNodes.length===0?<tr><td colSpan={5} className="empty-state">No edge nodes registered.</td></tr>:edgeNodes.map(node=><tr key={node.id}>
            <td><strong>{node.code}</strong><br/><small>{node.name}</small></td>
            <td>{node.branch.code}</td>
            <td>{node.status}</td>
            <td>{ageLabel(node.lastHeartbeatAt)}</td>
            <td>{ageLabel(node.lastSyncAt)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Backup & Restore Evidence</h2><span>{backups.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Backup time</th><th>Scope</th><th>Provider</th><th>Reference</th><th>Status</th><th>Restore test</th><th>Recorded by</th></tr></thead>
        <tbody>{backups.length===0?<tr><td colSpan={7} className="empty-state">No backup evidence recorded yet.</td></tr>:backups.map(item=><tr key={item.id}>
          <td>{item.backupCreatedAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td>{item.branch?.code || "Organization"}</td>
          <td>{item.provider}</td>
          <td>{item.backupReference}</td>
          <td><span className={"status-badge status-"+item.status.toLowerCase()}>{item.status}</span></td>
          <td>{item.restoreTestedAt ? item.restoreTestedAt.toISOString().slice(0,10)+(item.restoreDurationMinutes!==null?" · "+item.restoreDurationMinutes+" min":"") : "—"}</td>
          <td>{item.recordedBy.displayNameEn}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Disaster Recovery Drills</h2><span>{drills.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Title</th><th>Scope</th><th>Status</th><th>Scheduled</th><th>Target RPO/RTO</th><th>Actual RPO/RTO</th><th>Owner</th></tr></thead>
        <tbody>{drills.length===0?<tr><td colSpan={7} className="empty-state">No disaster recovery drills recorded.</td></tr>:drills.map(item=><tr key={item.id}>
          <td><strong>{item.title}</strong></td>
          <td>{item.branch?.code || "Organization"}</td>
          <td><span className={"status-badge status-"+item.status.toLowerCase().replaceAll("_","-")}>{item.status}</span></td>
          <td>{item.scheduledAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{item.targetRpoMinutes} / {item.targetRtoMinutes} min</td>
          <td>{item.actualRpoMinutes!==null&&item.actualRtoMinutes!==null?item.actualRpoMinutes+" / "+item.actualRtoMinutes+" min":"—"}</td>
          <td>{item.owner.displayNameEn}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Retention Policies</h2><span>{policies.length} configured</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Data class</th><th>Action</th><th>Retain days</th><th>Archive after</th><th>Enabled</th></tr></thead>
        <tbody>{policies.length===0?<tr><td colSpan={5} className="empty-state">No retention policies configured.</td></tr>:policies.map(policy=><tr key={policy.id}>
          <td><strong>{policy.dataClass}</strong></td><td>{policy.action}</td><td>{policy.retainDays ?? "—"}</td><td>{policy.archiveAfterDays ?? "—"}</td><td>{policy.enabled?"Yes":"No"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <ResilienceManager
      branches={branches.map(branch=>({id:branch.id,code:branch.code,nameEn:branch.nameEn}))}
      retentionPolicies={policies.map(policy=>({id:policy.id,dataClass:policy.dataClass,action:policy.action,retainDays:policy.retainDays,archiveAfterDays:policy.archiveAfterDays,enabled:policy.enabled}))}
      canManage={permissions.has("resilience.manage")}
      canArchive={permissions.has("resilience.archive")}
    />
  </main>;
}
