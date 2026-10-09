import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ResilienceManager } from "@/components/resilience-manager";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

function ageLabel(value: Date | null, locale: "ar" | "en") {
  if (!value) return tr(locale, "No record", "لا يوجد سجل");
  const ms = Date.now() - value.getTime();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 24) return locale === "ar" ? `منذ ${hours} ساعة` : hours + "h ago";
  const days = Math.floor(hours / 24);
  return locale === "ar" ? `منذ ${days} يوم` : days + "d ago";
}

export default async function ResiliencePage() {
  const session = await requirePermission("resilience.view");
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
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
    latestVerifiedEvidence,
    failedDrillCount,
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
      where: {
        organizationId: session.user.organizationId,
        status: "DEAD_LETTER",
        subscription: { endpoint: { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } },
      },
    }),
    prisma.analyzerMessage.count({
      where: { analyzer: { organizationId: session.user.organizationId, branchId: { in: branchIds } }, status: "DEAD_LETTER" },
    }),
    prisma.backupVerification.findFirst({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
        status: "VERIFIED",
        restoreTestedAt: { not: null },
        evidenceReference: { not: null },
      },
      select: { backupCreatedAt: true },
      orderBy: { backupCreatedAt: "desc" },
    }),
    prisma.disasterRecoveryDrill.count({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
        status: "FAILED",
      },
    }),
  ]);

  const latestBackup = backups[0]?.backupCreatedAt || null;
  const latestVerifiedBackup = latestVerifiedEvidence?.backupCreatedAt || null;
  const failedDrills = failedDrillCount;
  const pendingEdge = edgeQueueByStatus
    .filter(item => ["QUEUED","RECEIVED","FAILED"].includes(item.status))
    .reduce((sum, item) => sum + item._count._all, 0);
  const edgeDeadLetters = edgeQueueByStatus.find(item => item.status === "DEAD_LETTER")?._count._all || 0;
  const totalDeadLetters = integrationDeadLetters + webhookDeadLetters + analyzerDeadLetters + edgeDeadLetters;

  const localizedBranchName = (branch: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;
  const resilienceStatusLabel = (value: string) =>
    value === "RECORDED" ? tr(locale, "Recorded", "مسجل") :
    value === "PASSED" ? tr(locale, "Passed", "ناجح") :
    statusLabel(locale, value);
  const modeLabel = (value: string) =>
    value === "CENTRAL_ONLY" ? tr(locale, "Central only", "مركزي فقط") :
    value === "READ_ONLY_CACHE" ? tr(locale, "Read-only cache", "ذاكرة مؤقتة للقراءة فقط") :
    value === "BUFFER_NON_CLINICAL" ? tr(locale, "Buffer non-clinical events", "تخزين مؤقت للأحداث غير السريرية") :
    value;
  const actionLabel = (value: string) =>
    value === "RETAIN_ONLY" ? tr(locale, "Retain only", "احتفاظ فقط") :
    value === "ARCHIVE" ? tr(locale, "Archive", "أرشفة") :
    value === "PURGE" ? tr(locale, "Purge", "حذف نهائي") :
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
    return label ? tr(locale, label[0], label[1]) : value;
  };

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Resilience & Scale", "المرونة والاستمرارية")}</p>
        <h1>{tr(locale, "Operational Resilience", "المرونة التشغيلية")}</h1>
        <p className="muted">{tr(locale, "Health, backup evidence, disaster recovery, safe retention, branch continuity and non-clinical edge buffering. Clinical history remains protected from destructive retention.", "حالة التشغيل وأدلة النسخ الاحتياطي والتعافي من الكوارث وسياسات الاحتفاظ الآمن واستمرارية الفروع والتخزين المؤقت للأحداث غير السريرية. يبقى التاريخ السريري محمياً من سياسات الحذف الإتلافي.")}</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Latest backup", "أحدث نسخة احتياطية")}</span><strong>{ageLabel(latestBackup, locale)}</strong><small>{tr(locale, "Evidence recorded in LIS", "دليل مسجل داخل LIS")}</small></article>
      <article><span>{tr(locale, "Verified backup", "نسخة احتياطية متحقق منها")}</span><strong>{ageLabel(latestVerifiedBackup, locale)}</strong><small>{tr(locale, "Restore evidence present", "يتوفر دليل اختبار الاستعادة")}</small></article>
      <article className={totalDeadLetters ? "summary-attention" : ""}><span>{tr(locale, "Dead letters", "رسائل متعذرة المعالجة")}</span><strong>{totalDeadLetters}</strong><small>{tr(locale, "Analyzer + integration + webhook + edge", "أجهزة + تكامل + Webhook + Edge")}</small></article>
      <article className={failedDrills ? "summary-attention" : ""}><span>{tr(locale, "Failed DR drills", "اختبارات تعافي فاشلة")}</span><strong>{failedDrills}</strong><small>{pendingEdge} {tr(locale, "edge event(s) pending/review", "حدث Edge بانتظار المعالجة/المراجعة")}</small></article>
    </section>

    <section className="detail-grid">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Branch Continuity", "استمرارية الفروع")}</h2><span>{branches.length} {tr(locale, "branch(es)", "فرع")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Mode", "الوضع")}</th><th>{tr(locale, "Clinical offline writes", "الكتابة السريرية دون اتصال")}</th><th>{tr(locale, "Buffer window", "نافذة التخزين المؤقت")}</th></tr></thead>
          <tbody>{branches.map(branch => <tr key={branch.id}>
            <td><strong>{branch.code}</strong><br/><small>{localizedBranchName(branch)}</small></td>
            <td>{modeLabel(branch.continuityPolicy?.mode || "CENTRAL_ONLY")}</td>
            <td>{branch.continuityPolicy?.offlineClinicalWritesAllowed ? tr(locale, "ENABLED", "مفعلة") : tr(locale, "DISABLED", "معطلة")}</td>
            <td>{branch.continuityPolicy?.localBufferMinutes ? branch.continuityPolicy.localBufferMinutes + " " + tr(locale, "min", "دقيقة") : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Edge Nodes", "عُقد Edge")}</h2><span>{edgeNodes.length} {tr(locale, "node(s)", "عقدة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Node", "العقدة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Heartbeat", "آخر نبضة")}</th><th>{tr(locale, "Last sync", "آخر مزامنة")}</th></tr></thead>
          <tbody>{edgeNodes.length===0?<tr><td colSpan={5} className="empty-state">{tr(locale, "No edge nodes registered.", "لا توجد عُقد Edge مسجلة.")}</td></tr>:edgeNodes.map(node=><tr key={node.id}>
            <td><strong>{node.code}</strong><br/><small>{node.name}</small></td>
            <td>{node.branch.code} — {localizedBranchName(node.branch)}</td>
            <td>{resilienceStatusLabel(node.status)}</td>
            <td>{ageLabel(node.lastHeartbeatAt, locale)}</td>
            <td>{ageLabel(node.lastSyncAt, locale)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Backup & Restore Evidence", "أدلة النسخ الاحتياطي والاستعادة")}</h2><span>{backups.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Backup time", "وقت النسخ الاحتياطي")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Provider", "المزود")}</th><th>{tr(locale, "Reference", "المرجع")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Restore test", "اختبار الاستعادة")}</th><th>{tr(locale, "Recorded by", "سجله")}</th></tr></thead>
        <tbody>{backups.length===0?<tr><td colSpan={7} className="empty-state">{tr(locale, "No backup evidence recorded yet.", "لا توجد أدلة نسخ احتياطي مسجلة بعد.")}</td></tr>:backups.map(item=><tr key={item.id}>
          <td>{item.backupCreatedAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td>{item.branch ? item.branch.code + " — " + localizedBranchName(item.branch) : tr(locale, "Organization", "المؤسسة")}</td>
          <td>{item.provider}</td>
          <td>{item.backupReference}</td>
          <td><span className={"status-badge status-"+item.status.toLowerCase()}>{resilienceStatusLabel(item.status)}</span></td>
          <td>{item.restoreTestedAt ? item.restoreTestedAt.toISOString().slice(0,10)+(item.restoreDurationMinutes!==null?" · "+item.restoreDurationMinutes+" "+tr(locale, "min", "دقيقة"):"") : "—"}</td>
          <td>{item.recordedBy.displayNameEn}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Disaster Recovery Drills", "اختبارات التعافي من الكوارث")}</h2><span>{drills.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Title", "العنوان")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Scheduled", "المجدول")}</th><th>{tr(locale, "Target RPO/RTO", "RPO/RTO المستهدف")}</th><th>{tr(locale, "Actual RPO/RTO", "RPO/RTO الفعلي")}</th><th>{tr(locale, "Owner", "المسؤول")}</th></tr></thead>
        <tbody>{drills.length===0?<tr><td colSpan={7} className="empty-state">{tr(locale, "No disaster recovery drills recorded.", "لا توجد اختبارات تعافٍ من الكوارث مسجلة.")}</td></tr>:drills.map(item=><tr key={item.id}>
          <td><strong>{item.title}</strong></td>
          <td>{item.branch ? item.branch.code + " — " + localizedBranchName(item.branch) : tr(locale, "Organization", "المؤسسة")}</td>
          <td><span className={"status-badge status-"+item.status.toLowerCase().replaceAll("_","-")}>{resilienceStatusLabel(item.status)}</span></td>
          <td>{item.scheduledAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{item.targetRpoMinutes} / {item.targetRtoMinutes} {tr(locale, "min", "دقيقة")}</td>
          <td>{item.actualRpoMinutes!==null&&item.actualRtoMinutes!==null?item.actualRpoMinutes+" / "+item.actualRtoMinutes+" "+tr(locale, "min", "دقيقة"):"—"}</td>
          <td>{item.owner.displayNameEn}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Retention Policies", "سياسات الاحتفاظ")}</h2><span>{policies.length} {tr(locale, "configured", "مهيأة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Data class", "فئة البيانات")}</th><th>{tr(locale, "Action", "الإجراء")}</th><th>{tr(locale, "Retain days", "أيام الاحتفاظ")}</th><th>{tr(locale, "Archive after", "الأرشفة بعد")}</th><th>{tr(locale, "Enabled", "مفعلة")}</th></tr></thead>
        <tbody>{policies.length===0?<tr><td colSpan={5} className="empty-state">{tr(locale, "No retention policies configured.", "لا توجد سياسات احتفاظ مهيأة.")}</td></tr>:policies.map(policy=><tr key={policy.id}>
          <td><strong>{dataClassLabel(policy.dataClass)}</strong></td><td>{actionLabel(policy.action)}</td><td>{policy.retainDays ?? "—"}</td><td>{policy.archiveAfterDays ?? "—"}</td><td>{policy.enabled?tr(locale, "Yes", "نعم"):tr(locale, "No", "لا")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <ResilienceManager
      locale={locale}
      branches={branches.map(branch=>({id:branch.id,code:branch.code,nameEn:branch.nameEn,nameAr:branch.nameAr}))}
      retentionPolicies={policies.map(policy=>({id:policy.id,dataClass:policy.dataClass,action:policy.action,retainDays:policy.retainDays,archiveAfterDays:policy.archiveAfterDays,enabled:policy.enabled}))}
      canManage={permissions.has("resilience.manage")}
      canArchive={permissions.has("resilience.archive")}
    />
  </main>;
}
