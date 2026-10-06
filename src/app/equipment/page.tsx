import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EquipmentManager } from "@/components/equipment-manager";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const session = await requirePermission("equipment.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
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
        maintenancePlans: { where: { status: "ACTIVE" }, orderBy: { nextDueAt: "asc" }, take: 1 },
        maintenanceEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        calibrationEvents: { orderBy: { createdAt: "desc" }, take: 1 },
        downtimeEvents: { orderBy: { startedAt: "desc" }, take: 1 },
        documents: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: [{ branch: { nameEn: "asc" } }, { name: "asc" }],
    }),
  ]);

  const openDowntime = equipment.filter(item => item.downtimeEvents[0]?.status === "OPEN").length;
  const calibrationFailed = equipment.filter(item => item.calibrationEvents[0]?.status === "FAIL").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Equipment Management", "إدارة المعدات")}</p>
        <h1>{tr(locale, "Equipment", "المعدات")}</h1>
        <p className="muted">{tr(locale, "Asset register, analyzer linkage, maintenance, calibration and downtime across branches.", "سجل الأصول وربط أجهزة التحليل والصيانة والمعايرة وأوقات التوقف عبر الفروع.")}</p>
      </div>
      <div className="result-actions">
        {permissions.has("qc.view") && <Link className="secondary-link" href="/qc">{tr(locale, "Quality Control", "ضبط الجودة")}</Link>}
        <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Equipment</h2><strong>{equipment.length}</strong><p className="muted">Assets in your authorized branches.</p></article>
      <article className="detail-card"><h2>{tr(locale, "Active Downtime", "توقفات نشطة")}</h2><strong>{openDowntime}</strong><p className="muted">{tr(locale, "Open equipment downtime events.", "أحداث توقف المعدات المفتوحة.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Calibration Failures", "فشل المعايرة")}</h2><strong>{calibrationFailed}</strong><p className="muted">{tr(locale, "Latest calibration status is FAIL.", "آخر حالة معايرة هي فشل.")}</p></article>
    </section>

    <EquipmentManager
      branches={branches}
      departments={departments}
      analyzers={analyzers}
      equipment={equipment.map(item => ({
        id: item.id,
        assetId: item.assetId,
        name: item.name,
        status: item.status,
        analyzerId: item.analyzerId,
        maintenancePlans: item.maintenancePlans.map(plan => ({
          id: plan.id,
          name: plan.name,
          nextDueAt: plan.nextDueAt.toISOString().slice(0,10),
        })),
      }))}
      canManage={permissions.has("equipment.manage")}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Equipment Register", "سجل المعدات")}</h2><span>{equipment.length} assets</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Asset</th><th>Branch</th><th>Department</th><th>Analyzer</th><th>Status</th><th>Maintenance</th><th>Calibration</th><th>Documents</th><th>Downtime</th></tr></thead>
        <tbody>{equipment.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No equipment registered.", "لا توجد معدات مسجلة.")}</td></tr> : equipment.map(item => <tr key={item.id}>
          <td><strong>{item.assetId}</strong><br/><small>{item.name}{item.serialNumber ? " · " + item.serialNumber : ""}</small></td>
          <td>{item.branch.code} — {item.branch.nameEn}</td>
          <td>{item.department?.nameEn || "—"}</td>
          <td>{item.analyzer ? item.analyzer.code + " — " + item.analyzer.name : "—"}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>
            {item.maintenanceEvents[0] ? item.maintenanceEvents[0].maintenanceType + " · " + item.maintenanceEvents[0].status : "—"}
            {item.maintenancePlans[0] ? <><br/><small>{tr(locale, "Next", "التالي")}: {item.maintenancePlans[0].nextDueAt.toISOString().slice(0,10)}</small></> : null}
          </td>
          <td>{item.calibrationEvents[0] ? item.calibrationEvents[0].status + (item.calibrationEvents[0].performedAt ? " · " + item.calibrationEvents[0].performedAt.toISOString().slice(0,10) : "") : "—"}</td>
          <td>{item.documents.length}</td>
          <td>{item.downtimeEvents[0]?.status === "OPEN" ? <strong className="critical-text">OPEN</strong> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
