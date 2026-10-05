import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EquipmentManager } from "@/components/equipment-manager";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const session = await requirePermission("equipment.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, departments, analyzers, equipment] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.department.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, branchId: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.analyzer.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, name: true, branchId: true, departmentId: true },
      orderBy: { name: "asc" },
    }),
    prisma.equipment.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        department: true,
        analyzer: true,
        maintenanceEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        calibrationEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        downtimeEvents: { orderBy: { startedAt: "desc" }, take: 1 },
      },
      orderBy: [{ branch: { nameEn: "asc" } }, { name: "asc" }],
    }),
  ]);

  const openDowntime = equipment.filter(item => item.downtimeEvents[0]?.status === "OPEN").length;
  const calibrationFailed = equipment.filter(item => item.calibrationEvents[0]?.status === "FAIL").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Equipment Management</p>
        <h1>Equipment</h1>
        <p className="muted">Asset register, analyzer linkage, maintenance, calibration and downtime across branches.</p>
      </div>
      <div className="result-actions">
        {permissions.has("qc.view") && <Link className="secondary-link" href="/qc">Quality Control</Link>}
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Equipment</h2><strong>{equipment.length}</strong><p className="muted">Assets in your authorized branches.</p></article>
      <article className="detail-card"><h2>Active Downtime</h2><strong>{openDowntime}</strong><p className="muted">Open equipment downtime events.</p></article>
      <article className="detail-card"><h2>Calibration Failures</h2><strong>{calibrationFailed}</strong><p className="muted">Latest calibration status is FAIL.</p></article>
    </section>

    <EquipmentManager
      branches={branches}
      departments={departments}
      analyzers={analyzers}
      equipment={equipment.map(item => ({ id: item.id, assetId: item.assetId, name: item.name, status: item.status, analyzerId: item.analyzerId }))}
      canManage={permissions.has("equipment.manage")}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Equipment Register</h2><span>{equipment.length} assets</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Asset</th><th>Branch</th><th>Department</th><th>Analyzer</th><th>Status</th><th>Last maintenance</th><th>Last calibration</th><th>Downtime</th></tr></thead>
        <tbody>{equipment.length === 0 ? <tr><td colSpan={8} className="empty-state">No equipment registered.</td></tr> : equipment.map(item => <tr key={item.id}>
          <td><strong>{item.assetId}</strong><br/><small>{item.name}{item.serialNumber ? " · " + item.serialNumber : ""}</small></td>
          <td>{item.branch.code} — {item.branch.nameEn}</td>
          <td>{item.department?.nameEn || "—"}</td>
          <td>{item.analyzer ? item.analyzer.code + " — " + item.analyzer.name : "—"}</td>
          <td>{item.status}</td>
          <td>{item.maintenanceEvents[0] ? item.maintenanceEvents[0].maintenanceType + " · " + item.maintenanceEvents[0].status : "—"}</td>
          <td>{item.calibrationEvents[0] ? item.calibrationEvents[0].status + (item.calibrationEvents[0].performedAt ? " · " + item.calibrationEvents[0].performedAt.toISOString().slice(0,10) : "") : "—"}</td>
          <td>{item.downtimeEvents[0]?.status === "OPEN" ? <strong className="critical-text">OPEN</strong> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
