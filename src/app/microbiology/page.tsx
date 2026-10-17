import { TableEmptyState } from "@/components/table-empty-state";
import Link from "next/link";
import { authorizedDepartmentIds, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyManager } from "@/components/microbiology-manager";
import { SystemDateText } from "@/components/system-date-text";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function MicrobiologyPage() {
  const session = await requirePermission("microbiology.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const departmentIds = authorizedDepartmentIds(session);

  const [cases, orderItems, organismCount, antibioticCount] = await Promise.all([
    prisma.microbiologyCase.findMany({
      where: {
        organizationId: session.user.organizationId,
        performingBranchId: { in: branchIds },
        ...(departmentIds.length > 0 ? { orderItem: { test: { departmentId: { in: departmentIds } } } } : {}),
      },
      include: {
        orderItem: { include: { test: true, order: { include: { patient: true } } } },
        specimen: true,
        performingBranch: true,
        _count: { select: { isolates: true, observations: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.orderItem.findMany({
      where: {
        order: { organizationId: session.user.organizationId },
        test: { workflowType: "MICROBIOLOGY", status: "ACTIVE", ...(departmentIds.length > 0 ? { departmentId: { in: departmentIds } } : {}) },
        microbiologyCases: { none: {} },
        specimenLinks: {
          some: {
            specimen: {
              status: { in: ["RECEIVED","IN_PROCESS"] },
              currentBranchId: { in: branchIds },
            },
          },
        },
      },
      include: {
        test: true,
        order: { include: { patient: true } },
        specimenLinks: {
          where: {
            specimen: {
              status: { in: ["RECEIVED","IN_PROCESS"] },
              currentBranchId: { in: branchIds },
            },
          },
          include: { specimen: { include: { currentBranch: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.organism.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.antibiotic.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);

  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) => locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const cultureLabel = (value: string) => value === "PENDING" ? tr(locale, "Pending", "قيد الانتظار") : value === "NO_GROWTH" ? tr(locale, "No growth", "لا يوجد نمو") : value === "GROWTH" ? tr(locale, "Growth", "نمو") : value === "MIXED_GROWTH" ? tr(locale, "Mixed growth", "نمو مختلط") : value === "CONTAMINATED" ? tr(locale, "Contaminated", "ملوث") : value;

  const candidates = orderItems.flatMap(item => item.specimenLinks.map(link => ({
    orderItemId: item.id,
    specimenId: link.specimen.id,
    performingBranchId: link.specimen.currentBranchId!,
    accession: item.order.accessionNumber,
    patient: patientName(item.order.patient),
    testCode: item.test.code,
    testName: locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot,
    barcode: link.specimen.barcode,
    branchName: link.specimen.currentBranch ? localizedName(link.specimen.currentBranch) : "—",
  })));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Microbiology", "الأحياء الدقيقة")}</p>
        <h1>{tr(locale, "Culture & Susceptibility", "الزرع والحساسية")}</h1>
        <p className="muted">{tr(locale, "Dedicated microbiology workflow over the shared order, specimen and result architecture.", "مسار عمل مخصص للأحياء الدقيقة مبني فوق بنية الطلبات والعينات والنتائج المشتركة.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Open cases", "الحالات المفتوحة")}</h2><strong>{cases.filter(item => !["FINAL","CANCELLED"].includes(item.status)).length}</strong></article>
      <article className="detail-card"><h2>{tr(locale, "Organisms", "الكائنات الدقيقة")}</h2><strong>{organismCount}</strong></article>
      <article className="detail-card"><h2>{tr(locale, "Antibiotics", "المضادات الحيوية")}</h2><strong>{antibioticCount}</strong></article>
    </section>

    {(permissions.has("microbiology.enter") || permissions.has("microbiology.manage")) && <MicrobiologyManager
      candidates={candidates}
      canEnter={permissions.has("microbiology.enter")}
      canManage={permissions.has("microbiology.manage")}
      locale={locale}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Microbiology Cases", "حالات الأحياء الدقيقة")}</h2><span>{cases.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Accession / Patient", "رقم الطلب / المريض")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Culture", "الزرع")}</th><th>{tr(locale, "Case status", "حالة الحالة")}</th><th>{tr(locale, "Content", "المحتوى")}</th><th>{tr(locale, "Updated", "آخر تحديث")}</th><th>{tr(locale, "Action", "الإجراء")}</th></tr></thead>
        <tbody>{cases.length === 0 ? <tr><td colSpan={8} className="empty-state"><TableEmptyState title={tr(locale, "No microbiology cases yet.", "لا توجد حالات أحياء دقيقة بعد.")} description={tr(locale, "No culture or susceptibility cases appear in the authorized queue. Cases originate from ordered microbiology tests and valid specimens.", "لا تظهر حالات زرع أو حساسية في القائمة المصرح بها. تنشأ الحالات من فحوص الأحياء الدقيقة المطلوبة والعينات الصحيحة.")} /></td></tr> : cases.map(item => <tr key={item.id}>
          <td><strong>{item.orderItem.order.accessionNumber}</strong><br/><small>{patientName(item.orderItem.order.patient)}</small></td>
          <td>{item.orderItem.testCodeSnapshot} — {locale === "ar" ? item.orderItem.testNameArSnapshot || item.orderItem.testNameEnSnapshot : item.orderItem.testNameEnSnapshot}</td>
          <td>{item.specimen.barcode}<br/><small>{localizedName(item.performingBranch)}</small></td>
          <td>{cultureLabel(item.cultureStatus)}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>{item._count.observations} {tr(locale, "observation(s)", "ملاحظة")} · {item._count.isolates} {tr(locale, "isolate(s)", "عزلة")}</td>
            <td><SystemDateText value={item.updatedAt.toISOString()} timeZone={item.performingBranch.timezone} /></td>
          <td><Link className="secondary-link" href={`/microbiology/${item.id}`}>{tr(locale, "Open Case", "فتح الحالة")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
