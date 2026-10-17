import { TableEmptyState } from "@/components/table-empty-state";
import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { QcManager } from "@/components/qc-manager";
import { LeveyJenningsChart } from "@/components/levey-jennings-chart";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function QcPage() {
  const session = await requirePermission("qc.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
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
      select: { id: true, code: true, nameEn: true, nameAr: true, levelName: true },
      orderBy: [{ code: "asc" }, { levelName: "asc" }],
    }),
    prisma.qcLot.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { material: true },
      orderBy: [{ expiryDate: "asc" }, { lotNumber: "asc" }],
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true, nameAr: true },
          orderBy: { displayOrder: "asc" },
        },
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
        operator: true,
        results: {
          include: {
            target: {
              include: {
                qcLot: { include: { material: true } },
              },
            },
          },
        },
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
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) =>
    locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;
  const qcStatusLabel = (value: string) =>
    value === "PASS" ? tr(locale, "Pass", "ناجح") :
    value === "WARN" ? tr(locale, "Warning", "تحذير") :
    value === "FAIL" ? tr(locale, "Fail", "فشل") :
    value === "OPEN" ? tr(locale, "Open", "مفتوح") :
    value === "RESOLVED" ? tr(locale, "Resolved", "تمت المعالجة") :
    statusLabel(locale, value);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Quality Control", "ضبط الجودة")}</p>
        <h1>{tr(locale, "QC & Westgard", "ضبط الجودة وقواعد Westgard")}</h1>
        <p className="muted">{tr(locale, "Control materials, lots, effective targets, QC runs, Levey-Jennings trends and Westgard violations across authorized branches.", "مواد الضبط والتشغيلات والأهداف الفعالة وتشغيلات QC ومخططات Levey-Jennings ومخالفات Westgard عبر الفروع المصرح بها.")}</p>
      </div>
      <div className="result-actions">
        {permissions.has("equipment.view") && <Link className="secondary-link" href="/equipment">{tr(locale, "Equipment", "المعدات")}</Link>}
        <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Active Targets", "الأهداف النشطة")}</h2><strong>{targets.length}</strong><p className="muted">{tr(locale, "Analyzer/test/component QC definitions.", "تعريفات QC بحسب الجهاز والفحص والمكوّن.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Open Violations", "المخالفات المفتوحة")}</h2><strong>{openViolations.length}</strong><p className="muted">{tr(locale, "Westgard warnings and blocks awaiting corrective action.", "تحذيرات وحالات حظر Westgard التي تنتظر إجراءً تصحيحياً.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Failed Runs", "تشغيلات فاشلة")}</h2><strong>{failedRuns}</strong><p className="muted">{tr(locale, "Within the latest", "ضمن أحدث")} {recentRuns.length} {tr(locale, "QC runs.", "تشغيل QC.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Warnings", "تحذيرات")}</h2><strong>{warningRuns}</strong><p className="muted">{tr(locale, "QC runs requiring review.", "تشغيلات QC تحتاج إلى مراجعة.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Expired Lots", "تشغيلات منتهية")}</h2><strong>{expiredLots}</strong><p className="muted">{tr(locale, "Active QC lots past expiry and therefore unusable by the QC gate.", "تشغيلات QC النشطة التي تجاوزت تاريخ الانتهاء ولذلك لا يمكن استخدامها ضمن بوابة QC.")}</p></article>
    </section>

    <QcManager
      locale={locale}
      analyzers={analyzers}
      materials={materials}
      lots={lots.map(lot => ({
        id: lot.id,
        materialId: lot.materialId,
        lotNumber: lot.lotNumber,
        label: `${lot.material.code} · ${localizedName(lot.material)} · ${lot.material.levelName} · ${lot.lotNumber}${lot.expiryDate ? " · " + tr(locale, "exp", "انتهاء") + " " + lot.expiryDate.toISOString().slice(0,10) : ""}`,
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
        locale={locale}
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
      <div className="table-toolbar"><h2>{tr(locale, "Recent QC Runs", "أحدث تشغيلات QC")}</h2><span>{recentRuns.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Run", "التشغيل")}</th><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Control lot", "تشغيلة الضبط")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Results", "النتائج")}</th><th>{tr(locale, "Violations", "المخالفات")}</th><th>{tr(locale, "Operator", "المشغل")}</th></tr></thead>
        <tbody>{recentRuns.length === 0 ? <tr><td colSpan={7} className="empty-state"><TableEmptyState title={tr(locale, "No QC runs recorded.", "لا توجد تشغيلات QC مسجلة.")} description={tr(locale, "No quality-control runs are displayed. QC observations must be entered from approved control material before policy evaluation.", "لا تظهر تشغيلات ضبط جودة. يجب إدخال مشاهدات QC من مواد ضبط معتمدة قبل تقييم القواعد.")} /></td></tr> : recentRuns.map(run => <tr key={run.id}>
          <td>{run.runAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td><strong>{run.analyzer.code}</strong><br/><small>{run.analyzer.name}</small></td>
          <td>{[...new Map(run.results.map(result => [
            result.target.qcLotId,
            result.target.qcLot.material.code + " · " + result.target.qcLot.material.levelName + " · " + result.target.qcLot.lotNumber,
          ])).values()].join(" | ") || "—"}</td>
          <td>{qcStatusLabel(run.status)}</td>
          <td>{run.results.length}</td>
          <td>{run.violations.length}</td>
          <td>{userName(run.operator)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "QC Targets", "أهداف QC")}</h2><span>{targets.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Control", "الضبط")}</th><th>{tr(locale, "Mean", "المتوسط")}</th><th>SD</th><th>CV</th><th>{tr(locale, "Valid", "الصلاحية")}</th><th>{tr(locale, "Rules", "القواعد")}</th></tr></thead>
        <tbody>{targets.length === 0 ? <tr><td colSpan={8} className="empty-state"><TableEmptyState title={tr(locale, "No QC targets configured.", "لا توجد أهداف QC مهيأة.")} description={tr(locale, "No QC targets are configured in this view. Define approved target ranges before relying on release-block policies.", "لا تظهر أهداف ضبط جودة مهيأة في هذا العرض. حدّد المجالات المعتمدة قبل الاعتماد على سياسات حظر الإصدار.")} /></td></tr> : targets.map(target => <tr key={target.id}>
          <td>{target.analyzer.code}</td>
          <td>{target.test.code}{target.component ? " / " + target.component.code : ""}</td>
          <td>{target.qcLot.material.code} · {target.qcLot.material.levelName}<br/><small>{target.qcLot.lotNumber}</small></td>
          <td>{target.targetMean.toString()}</td>
          <td>{target.targetSd.toString()}</td>
          <td>{target.targetCv?.toString() || "—"}</td>
          <td>{target.qcValidHours} {tr(locale, "h", "ساعة")}</td>
          <td>{Array.isArray(target.enabledRules) ? target.enabledRules.join(", ") : tr(locale, "Configured", "مهيأة")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
