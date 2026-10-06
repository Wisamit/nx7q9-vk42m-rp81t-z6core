import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requirePermission("reports.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const reports = await prisma.diagnosticReport.findMany({
    where: {
      organizationId: session.user.organizationId,
      order: { orderingBranchId: { in: branchIds } },
    },
    include: {
      order: { include: { patient: true, orderingBranch: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { issuedBy: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Reporting", "التقارير")}</p>
        <h1>{tr(locale, "Diagnostic Reports", "التقارير التشخيصية")}</h1>
        <p className="muted">{tr(locale, "Released report versions are immutable. New releases and amendments create new versions instead of changing history.", "إصدارات التقارير الصادرة غير قابلة للتعديل، وأي إصدار أو تعديل جديد ينشئ نسخة جديدة دون تغيير التاريخ.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr(locale, "Released Reports", "التقارير الصادرة")}</h2><span>{reports.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Version", "الإصدار")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Issued", "تاريخ الإصدار")}</th><th>{tr(locale, "Issued by", "أصدر بواسطة")}</th><th></th></tr></thead>
          <tbody>
            {reports.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No released diagnostic reports yet.", "لا توجد تقارير تشخيصية صادرة بعد.")}</td></tr> :
              reports.map(report => {
                const version = report.versions[0];
                return <tr key={report.id}>
                  <td><strong>{report.order.accessionNumber}</strong></td>
                  <td>{report.order.patient.patientNumber}<br/><small>{report.order.patient.fullNameEn}</small></td>
                  <td>{report.order.orderingBranch.nameEn}</td>
                  <td>{version?.version || report.currentVersion}</td>
                  <td>{statusLabel(locale, version?.status)}</td>
                  <td>{version?.issuedAt.toISOString().replace("T"," ").slice(0,19) || "—"}</td>
                  <td>{version?.issuedBy.displayNameEn || "—"}</td>
                  <td><Link className="secondary-link" href={`/reports/${report.orderId}`}>{tr(locale, "Open", "فتح")}</Link></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
