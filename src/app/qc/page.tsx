import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { QcManager } from "@/components/qc-manager";
import { LeveyJenningsChart } from "@/components/levey-jennings-chart";

export const dynamic = "force-dynamic";

export default async function QcPage() {
  const session = await requirePermission("qc.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [analyzers, materials, lots, tests, targets, recentRuns, openViolations] = await Promise.all([
    prisma.analyzer.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        status: "ACTIVE",
      },
      select: { id: true, code: true, name: true, branchId: true },
      orderBy: [{ branch: { nameEn: "asc" } }, { name: "asc" }],
    }),
    prisma.qcMaterial.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, levelName: true },
      orderBy: [{ code: "asc" }, { levelName: "asc" }],
    }),
    prisma.qcLot.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { material: true },
      orderBy: [{ expiryDate: "asc" }, { lotNumber: "asc" }],
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: {
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        components: true,
      },
      orderBy: { nameEn: "asc" },
    }),
    prisma.qcTarget.findMany({
      where: {
        organizationId: session.user.organizationId,
        analyzer: { branchId: { in: branchIds } },
        status: "ACTIVE",
      },
      include: {
        analyzer: true,
        qcLot: { include: { material: true } },
        test: true,
        component: true,
        results: {
          include: { run: { select: { runAt: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.qcRun.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
      },
      include: {
        analyzer: true,
        qcLot: { include: { material: true } },
        operator: true,
        results: true,
        violations: true,
      },
      orderBy: { runAt: "desc" },
      take: 100,
    }),
    prisma.qcRuleViolation.findMany({
      where: {
        status: "OPEN",
        run: {
          organizationId: session.user.organizationId,
          branchId: { in: branchIds },
        },
      },
      include: {
        run: { include: { analyzer: true } },
        target: { include: { test: true, component: true } },
      },
      orderBy: { detectedAt: "desc" },
      take: 100,
    }),
  ]);

  const now = new Date();
  const expiredLots = lots.filter(lot => lot.expiryDate && lot.expiryDate < now).length;
  const failedRuns = recentRuns.filter(run => run.status === "FAIL").length;
  const warningRuns = recentRuns.filter(run => run.status === "WARN").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Quality Control</p>
        <h1>QC & Westgard</h1>
        <p className="muted">Control materials, lots, effective targets, QC runs, Levey-Jennings trends and Westgard violations across authorized branches.</p>
      </div>
      <div className="result-actions">
        {permissions.has("equipment.view") && <Link className="secondary-link" href="/equipment">Equipment</Link>}
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Active Targets</h2><strong>{targets.length}</strong><p className="muted">Analyzer/test/component QC definitions.</p></article>
      <article className="detail-card"><h2>Open Violations</h2><strong>{openViolations.length}</strong><p className="muted">Westgard warnings and blocks awaiting corrective action.</p></article>
      <article className="detail-card"><h2>Failed Runs</h2><strong>{failedRuns}</strong><p className="muted">Within the latest {recentRuns.length} QC runs.</p></article>
      <article className="detail-card"><h2>Warnings</h2><strong>{warningRuns}</strong><p className="muted">QC runs requiring review.</p></article>
      <article className="detail-card"><h2>Expired Lots</h2><strong>{expiredLots}</strong><p className="muted">Active QC lots past expiry and therefore unusable by the QC gate.</p></article>
    </section>

    <QcManager
      analyzers={analyzers}
      materials={materials}
      lots={lots.map(lot => ({
        id: lot.id,
        materialId: lot.materialId,
        lotNumber: lot.lotNumber,
        label: `${lot.material.code} · ${lot.material.levelName} · ${lot.lotNumber}${lot.expiryDate ? " · exp " + lot.expiryDate.toISOString().slice(0,10) : ""}`,
      }))}
      tests={tests}
      targets={targets.map(target => ({
        id: target.id,
        analyzerId: target.analyzerId,
        qcLotId: target.qcLotId,
        testId: target.testId,
        componentId: target.componentId,
        label: `${target.analyzer.code} · ${target.test.code}${target.component ? "/" + target.component.code : ""} · ${target.qcLot.material.levelName} · ${target.qcLot.lotNumber}`,
      }))}
      openViolations={openViolations.map(item => ({
        id: item.id,
        ruleCode: item.ruleCode,
        severity: item.severity,
        analyzer: item.run.analyzer.code + " — " + item.run.analyzer.name,
        target: item.target.test.code + (item.target.component ? "/" + item.target.component.code : ""),
      }))}
      canManage={permissions.has("qc.manage")}
      canEnter={permissions.has("qc.enter")}
      canResolve={permissions.has("qc.resolve")}
    />

    <section className="detail-grid detail-section">
      {targets.slice(0, 12).map(target => <LeveyJenningsChart
        key={target.id}
        title={target.analyzer.code + " · " + target.test.code + (target.component ? "/" + target.component.code : "") + " · " + target.qcLot.material.levelName}
        points={target.results.map(result => ({
          id: result.id,
          runAt: result.run.runAt.toISOString(),
          zScore: result.zScore.toNumber(),
          status: result.status,
        }))}
      />)}
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Recent QC Runs</h2><span>{recentRuns.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Run</th><th>Analyzer</th><th>Control lot</th><th>Status</th><th>Results</th><th>Violations</th><th>Operator</th></tr></thead>
        <tbody>{recentRuns.length === 0 ? <tr><td colSpan={7} className="empty-state">No QC runs recorded.</td></tr> : recentRuns.map(run => <tr key={run.id}>
          <td>{run.runAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td><strong>{run.analyzer.code}</strong><br/><small>{run.analyzer.name}</small></td>
          <td>{run.qcLot.material.code} · {run.qcLot.material.levelName}<br/><small>{run.qcLot.lotNumber}</small></td>
          <td>{run.status}</td>
          <td>{run.results.length}</td>
          <td>{run.violations.length}</td>
          <td>{run.operator.displayNameEn}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>QC Targets</h2><span>{targets.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Analyzer</th><th>Test</th><th>Control</th><th>Mean</th><th>SD</th><th>CV</th><th>Valid</th><th>Rules</th></tr></thead>
        <tbody>{targets.length === 0 ? <tr><td colSpan={8} className="empty-state">No QC targets configured.</td></tr> : targets.map(target => <tr key={target.id}>
          <td>{target.analyzer.code}</td>
          <td>{target.test.code}{target.component ? " / " + target.component.code : ""}</td>
          <td>{target.qcLot.material.code} · {target.qcLot.material.levelName}<br/><small>{target.qcLot.lotNumber}</small></td>
          <td>{target.targetMean.toString()}</td>
          <td>{target.targetSd.toString()}</td>
          <td>{target.targetCv?.toString() || "—"}</td>
          <td>{target.qcValidHours}h</td>
          <td>{Array.isArray(target.enabledRules) ? target.enabledRules.join(", ") : "Configured"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
