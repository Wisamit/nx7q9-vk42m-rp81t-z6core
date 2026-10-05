import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { QualityManagementConsole } from "@/components/quality-management-console";

export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const session = await requirePermission("quality.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const scopedBranch = {
    OR: [{ branchId: null }, { branchId: { in: branchIds } }],
  };

  const [
    branches,
    users,
    analyzers,
    nonconformances,
    capas,
    documents,
    trainingRecords,
    competencies,
    authorizations,
    indicators,
    audits,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.user.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        OR: [
          { id: session.user.id },
          { branchScopes: { some: { branchId: { in: branchIds } } } },
        ],
      },
      select: { id: true, username: true, displayNameEn: true },
      orderBy: { displayNameEn: "asc" },
      take: 500,
    }),
    prisma.analyzer.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, name: true, branchId: true },
      orderBy: [{ branch: { nameEn: "asc" } }, { name: "asc" }],
    }),
    prisma.nonconformance.findMany({
      where: { organizationId: session.user.organizationId, ...scopedBranch },
      include: { branch: true, reportedBy: true, owner: true, capas: { select: { id: true, capaNumber: true, status: true } } },
      orderBy: { detectedAt: "desc" },
      take: 250,
    }),
    prisma.capa.findMany({
      where: { organizationId: session.user.organizationId, ...scopedBranch },
      include: {
        branch: true,
        owner: true,
        nonconformance: { select: { caseNumber: true } },
        actions: { include: { owner: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.qualityDocument.findMany({
      where: { organizationId: session.user.organizationId, ...scopedBranch },
      include: {
        branch: true,
        owner: true,
        versions: {
          include: { submittedBy: true, reviewedBy: true, approvedBy: true },
          orderBy: { version: "desc" },
          take: 10,
        },
      },
      orderBy: { code: "asc" },
      take: 250,
    }),
    prisma.trainingRecord.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { branchId: { in: branchIds } },
          { branchId: null, analyzerId: null },
          { branchId: null, analyzer: { branchId: { in: branchIds } } },
        ],
      },
      include: { user: true, analyzer: true, documentVersion: { include: { document: true } } },
      orderBy: { assignedAt: "desc" },
      take: 250,
    }),
    prisma.competencyAssessment.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { branchId: { in: branchIds } },
          { branchId: null, analyzerId: null },
          { branchId: null, analyzer: { branchId: { in: branchIds } } },
        ],
      },
      include: { user: true, analyzer: true, assessedBy: true },
      orderBy: { assessedAt: "desc" },
      take: 250,
    }),
    prisma.analyzerAuthorization.findMany({
      where: { organizationId: session.user.organizationId, analyzer: { branchId: { in: branchIds } } },
      include: { user: true, analyzer: true, approvedBy: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.qualityIndicator.findMany({
      where: { organizationId: session.user.organizationId, ...scopedBranch },
      include: { branch: true, measurements: { orderBy: { periodEnd: "desc" }, take: 12 } },
      orderBy: { code: "asc" },
      take: 250,
    }),
    prisma.internalAudit.findMany({
      where: { organizationId: session.user.organizationId, ...scopedBranch },
      include: {
        branch: true,
        leadAuditor: true,
        findings: { include: { owner: true, capa: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { scheduledAt: "desc" },
      take: 250,
    }),
  ]);

  const openNc = nonconformances.filter(item => !["CLOSED","CANCELLED"].includes(item.status)).length;
  const overdueCapas = capas.filter(item => item.dueDate && item.dueDate < new Date() && !["CLOSED","CANCELLED"].includes(item.status)).length;
  const documentReviewsDue = documents.flatMap(item => item.versions).filter(version =>
    version.status === "EFFECTIVE" && version.reviewDueAt && version.reviewDueAt < new Date()
  ).length;
  const competencyDue = competencies.filter(item => item.nextDueAt && item.nextDueAt < new Date()).length;
  const openFindings = audits.flatMap(item => item.findings).filter(item => item.status !== "CLOSED").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Quality Management</p>
        <h1>QMS Workspace</h1>
        <p className="muted">Nonconformance, CAPA, controlled documents, training, competency, quality indicators and internal audits with branch scope and audit history.</p>
      </div>
      <div className="result-actions">
        {permissions.has("qc.view") && <Link className="secondary-link" href="/qc">QC</Link>}
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Open Nonconformances</h2><strong>{openNc}</strong><p className="muted">Cases requiring investigation, action or closure.</p></article>
      <article className="detail-card"><h2>Overdue CAPA</h2><strong>{overdueCapas}</strong><p className="muted">Open CAPA beyond due date.</p></article>
      <article className="detail-card"><h2>Document Reviews Due</h2><strong>{documentReviewsDue}</strong><p className="muted">Effective controlled documents past review date.</p></article>
      <article className="detail-card"><h2>Competency Due</h2><strong>{competencyDue}</strong><p className="muted">Assessments past their next-due date.</p></article>
      <article className="detail-card"><h2>Open Audit Findings</h2><strong>{openFindings}</strong><p className="muted">Findings that must be addressed before audit closure.</p></article>
    </section>

    <QualityManagementConsole
      permissions={{
        nonconformance: permissions.has("quality.nonconformance.manage"),
        capa: permissions.has("quality.capa.manage"),
        documents: permissions.has("quality.documents.manage"),
        training: permissions.has("quality.training.manage"),
        indicators: permissions.has("quality.indicators.manage"),
        audits: permissions.has("quality.audits.manage"),
      }}
      branches={branches}
      users={users}
      analyzers={analyzers}
      nonconformances={nonconformances.map(item => ({
        id: item.id,
        caseNumber: item.caseNumber,
        title: item.title,
        category: item.category,
        severity: item.severity,
        status: item.status,
        branch: item.branch?.nameEn || "Organization",
        detectedAt: item.detectedAt.toISOString(),
        owner: item.owner?.displayNameEn || null,
        rootCause: item.rootCause,
        closureSummary: item.closureSummary,
        capas: item.capas,
      }))}
      capas={capas.map(item => ({
        id: item.id,
        capaNumber: item.capaNumber,
        title: item.title,
        status: item.status,
        branch: item.branch?.nameEn || "Organization",
        owner: item.owner.displayNameEn,
        dueDate: item.dueDate?.toISOString() || null,
        effectiveness: item.effectiveness,
        nonconformanceCase: item.nonconformance?.caseNumber || null,
        actions: item.actions.map(action => ({
          id: action.id,
          actionType: action.actionType,
          description: action.description,
          status: action.status,
          owner: action.owner?.displayNameEn || null,
          dueDate: action.dueDate?.toISOString() || null,
        })),
      }))}
      documents={documents.map(item => ({
        id: item.id,
        code: item.code,
        titleEn: item.titleEn,
        titleAr: item.titleAr,
        documentType: item.documentType,
        branch: item.branch?.nameEn || "Organization",
        currentEffectiveVersion: item.currentEffectiveVersion,
        versions: item.versions.map(version => ({
          id: version.id,
          version: version.version,
          status: version.status,
          changeSummary: version.changeSummary,
          effectiveFrom: version.effectiveFrom?.toISOString() || null,
          reviewDueAt: version.reviewDueAt?.toISOString() || null,
          externalUrl: version.externalUrl,
        })),
      }))}
      trainingRecords={trainingRecords.map(item => ({
        id: item.id,
        user: item.user.displayNameEn,
        title: item.title,
        status: item.status,
        analyzer: item.analyzer ? item.analyzer.code + " — " + item.analyzer.name : null,
        document: item.documentVersion ? item.documentVersion.document.code + " v" + item.documentVersion.version : null,
        assignedAt: item.assignedAt.toISOString(),
        completedAt: item.completedAt?.toISOString() || null,
        expiresAt: item.expiresAt?.toISOString() || null,
      }))}
      competencies={competencies.map(item => ({
        id: item.id,
        user: item.user.displayNameEn,
        competencyName: item.competencyName,
        result: item.result,
        analyzer: item.analyzer ? item.analyzer.code + " — " + item.analyzer.name : null,
        assessedAt: item.assessedAt.toISOString(),
        nextDueAt: item.nextDueAt?.toISOString() || null,
        assessor: item.assessedBy.displayNameEn,
      }))}
      authorizations={authorizations.map(item => ({
        id: item.id,
        user: item.user.displayNameEn,
        analyzer: item.analyzer.code + " — " + item.analyzer.name,
        status: item.status,
        authorizedAt: item.authorizedAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() || null,
        approvedBy: item.approvedBy.displayNameEn,
      }))}
      effectiveDocumentVersions={documents.flatMap(item => item.versions
        .filter(version => version.status === "EFFECTIVE")
        .map(version => ({
          id: version.id,
          label: item.code + " v" + version.version + " — " + item.titleEn,
        })))}
      indicators={indicators.map(item => ({
        id: item.id,
        code: item.code,
        nameEn: item.nameEn,
        branch: item.branch?.nameEn || "Organization",
        direction: item.direction,
        unit: item.unit,
        targetMin: item.targetMin?.toString() || null,
        targetMax: item.targetMax?.toString() || null,
        measurements: item.measurements.map(measurement => ({
          id: measurement.id,
          periodStart: measurement.periodStart.toISOString(),
          periodEnd: measurement.periodEnd.toISOString(),
          value: measurement.value.toString(),
        })),
      }))}
      audits={audits.map(item => ({
        id: item.id,
        auditNumber: item.auditNumber,
        title: item.title,
        scope: item.scope,
        status: item.status,
        branch: item.branch?.nameEn || "Organization",
        scheduledAt: item.scheduledAt.toISOString(),
        leadAuditor: item.leadAuditor.displayNameEn,
        findings: item.findings.map(finding => ({
          id: finding.id,
          findingNumber: finding.findingNumber,
          severity: finding.severity,
          description: finding.description,
          status: finding.status,
          owner: finding.owner?.displayNameEn || null,
          dueDate: finding.dueDate?.toISOString() || null,
          capaNumber: finding.capa?.capaNumber || null,
        })),
      }))}
    />
  </main>;
}
