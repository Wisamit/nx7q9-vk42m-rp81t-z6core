import { TableEmptyState } from "@/components/table-empty-state";
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
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.department.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true, branchId: true },
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
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const maintenanceTypeLabel = (value: string) =>
    value === "PREVENTIVE" ? tr(locale, "Preventive", "وقائية") :
    value === "CORRECTIVE" ? tr(locale, "Corrective", "تصحيحية") : value;
  const equipmentStatusLabel = (value: string) =>
    value === "PASS" ? tr(locale, "Pass", "ناجح") :
    value === "FAIL" ? tr(locale, "Fail", "فشل") :
    value === "OPEN" ? tr(locale, "Open", "مفتوح") :
    value === "CLOSED" ? tr(locale, "Closed", "مغلق") :
    statusLabel(locale, value);

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
      <article className="detail-card"><h2>{tr(locale, "Equipment", "المعدات")}</h2><strong>{equipment.length}</strong><p className="muted">{tr(locale, "Assets in your authorized branches.", "الأصول الموجودة ضمن الفروع المصرح لك بها.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Active Downtime", "توقفات نشطة")}</h2><strong>{openDowntime}</strong><p className="muted">{tr(locale, "Open equipment downtime events.", "أحداث توقف المعدات المفتوحة.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Calibration Failures", "فشل المعايرة")}</h2><strong>{calibrationFailed}</strong><p className="muted">{tr(locale, "Latest calibration status is FAIL.", "آخر حالة معايرة هي فشل.")}</p></article>
    </section>

    <EquipmentManager
      locale={locale}
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
      <div className="table-toolbar"><h2>{tr(locale, "Equipment Register", "سجل المعدات")}</h2><span>{equipment.length} {tr(locale, "assets", "أصل")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Asset", "الأصل")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Department", "القسم")}</th><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Maintenance", "الصيانة")}</th><th>{tr(locale, "Calibration", "المعايرة")}</th><th>{tr(locale, "Documents", "الوثائق")}</th><th>{tr(locale, "Downtime", "التوقف")}</th></tr></thead>
        <tbody>{equipment.length === 0 ? <tr><td colSpan={9} className="empty-state"><TableEmptyState title={tr(locale, "No equipment registered.", "لا توجد معدات مسجلة.")} description={tr(locale, "No equipment records appear in this branch scope. Register instruments with the correct branch before scheduling service or calibration.", "لا تظهر سجلات معدات ضمن نطاق الفرع. سجّل الأجهزة في فرعها الصحيح قبل جدولة الصيانة أو المعايرة.")} /></td></tr> : equipment.map(item => <tr key={item.id}>
          <td><strong>{item.assetId}</strong><br/><small>{item.name}{item.serialNumber ? " · " + item.serialNumber : ""}</small></td>
          <td>{item.branch.code} — {localizedName(item.branch)}</td>
          <td>{item.department ? localizedName(item.department) : "—"}</td>
          <td>{item.analyzer ? item.analyzer.code + " — " + item.analyzer.name : "—"}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>
            {item.maintenanceEvents[0] ? maintenanceTypeLabel(item.maintenanceEvents[0].maintenanceType) + " · " + equipmentStatusLabel(item.maintenanceEvents[0].status) : "—"}
            {item.maintenancePlans[0] ? <><br/><small>{tr(locale, "Next", "التالي")}: {item.maintenancePlans[0].nextDueAt.toISOString().slice(0,10)}</small></> : null}
          </td>
          <td>{item.calibrationEvents[0] ? equipmentStatusLabel(item.calibrationEvents[0].status) + (item.calibrationEvents[0].performedAt ? " · " + item.calibrationEvents[0].performedAt.toISOString().slice(0,10) : "") : "—"}</td>
          <td>{item.documents.length}</td>
          <td>{item.downtimeEvents[0]?.status === "OPEN" ? <strong className="critical-text">{tr(locale, "OPEN", "مفتوح")}</strong> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
