import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";
import {
  buildReportQueueQueries,
  reportQueuePatientIdentity,
  parseReportQueueFilters,
  reportQueueHref,
  REPORT_QUEUE_PAGE_SIZE,
} from "@/lib/report-print-queue";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requirePermission("reports.view");
  const locale = getUiLocale(session.user.preferredLocale);
  // Branch scope comes from the logged-in session, never from untrusted query
  // parameters. Retired branch scopes remain visible for historical reports.
  const authorizedBranchIds = [...new Set(session.user.branchScopes
    .filter(scope => scope.branch.organizationId === session.user.organizationId)
    .map(scope => scope.branchId))];
  const parsed = parseReportQueueFilters(await searchParams, authorizedBranchIds);
  if (!parsed.ok) {
    return <main className="catalog-shell">
      <header className="page-header">
        <div><h1>{tr(locale, "Invalid report queue filter", "تصفية طابور التقارير غير صالحة")}</h1>
          <p role="alert" className="form-error">{parsed.error === "branch_forbidden"
            ? tr(locale, "You are not authorized to view this branch.", "لا تملك صلاحية عرض تقارير هذا الفرع.")
            : tr(locale, "Check the page, dates and search filters. No reports were displayed.",
              "تحقق من رقم الصفحة والتواريخ ومعايير البحث. لم تُعرض أي تقارير.")}</p></div>
        <Link className="secondary-link" href="/reports">{tr(locale, "Reset filters", "مسح التصفية")}</Link>
      </header>
    </main>;
  }

  const filters = parsed.value;
  const branches = authorizedBranchIds.length
    ? await prisma.branch.findMany({
      where: { id: { in: authorizedBranchIds }, organizationId: session.user.organizationId },
      select: { id: true, nameEn: true, nameAr: true, code: true },
      orderBy: { code: "asc" },
    })
    : [];

  const queries = authorizedBranchIds.length
    ? buildReportQueueQueries({
      organizationId: session.user.organizationId,
      authorizedBranchIds,
      filters,
    })
    : null;

  // SQL is built solely from fixed internal predicates and positional
  // placeholders. Values (including every authorized branch) are bound, not
  // interpolated. The join insists on the report's current version: older
  // printed versions cannot satisfy the new version's PRINT event filter.
  const counts = queries
    ? await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      queries.count.sql, ...queries.count.params)
    : [{ total: BigInt(0) }];
  const totalReports = Number(counts[0]?.total || BigInt(0));
  const totalPages = Math.max(1, Math.ceil(totalReports / REPORT_QUEUE_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const requestedIds = queries
    ? buildReportQueueQueries({
      organizationId: session.user.organizationId,
      authorizedBranchIds,
      filters: { ...filters, page },
    }).ids
    : null;
  const pointers = requestedIds
    ? await prisma.$queryRawUnsafe<Array<{ reportId: string; versionId: string }>>(
      requestedIds.sql, ...requestedIds.params)
    : [];

  const reports = pointers.length
    ? await prisma.diagnosticReport.findMany({
      where: {
        organizationId: session.user.organizationId,
        id: { in: pointers.map(row => row.reportId) },
        order: { organizationId: session.user.organizationId,
          orderingBranchId: { in: authorizedBranchIds } },
      },
      include: {
        order: { include: { orderingBranch: true } },
        versions: {
          where: { id: { in: pointers.map(row => row.versionId) } },
          take: 1,
          include: {
            issuedBy: true,
            deliveries: {
              where: { channel: "PRINT", status: "RECORDED" },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    })
    : [];

  const byId = new Map(reports.map(report => [report.id, report]));
  const shown = pointers.flatMap(pointer => {
    const report = byId.get(pointer.reportId);
    const version = report?.versions[0];
    return report && version?.id === pointer.versionId
      ? [{ report, version }]
      : [];
  });
  const dateLabels = { from: filters.from, to: filters.to };

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Reporting", "التقارير")}</p>
        <h1>{tr(locale, "Diagnostic Reports & Print Audit Queue", "التقارير التشخيصية وطابور سجل الطباعة")}</h1>
        <p className="muted">{tr(locale,
          "Filters refer to the current immutable report version. Recorded print events are audit evidence of a browser print request, not confirmation of physical printing.",
          "تُطبّق التصفية على آخر إصدار غير قابل للتعديل. حدث الطباعة المسجل دليل على طلب الطباعة من المتصفح، وليس تأكيداً لخروج الورق فعلياً.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <section className="table-card">
      <div className="table-toolbar">
        <h2>{tr(locale, "Find reports", "البحث عن التقارير")}</h2>
        <Link className="secondary-link" href="/reports">{tr(locale, "Clear filters", "مسح التصفية")}</Link>
      </div>
      <form className="catalog-form" method="get" action="/reports">
        <label>{tr(locale, "Branch", "الفرع")}
          <select name="branchId" defaultValue={filters.branchId}>
            <option value="">{tr(locale, "All authorized branches", "جميع الفروع المسموح بها")}</option>
            {branches.map(branch => <option key={branch.id} value={branch.id}>
              {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn} ({branch.code})
            </option>)}
          </select>
        </label>
        <label>{tr(locale, "Current report status", "حالة الإصدار الحالي")}
          <select name="status" defaultValue={filters.status}>
            <option value="ALL">{tr(locale, "All statuses", "جميع الحالات")}</option>
            {(["PARTIAL","FINAL","AMENDED","RETRACTED"] as const).map(status =>
              <option key={status} value={status}>{statusLabel(locale, status)}</option>)}
          </select>
        </label>
        <label>{tr(locale, "Print audit record (current version)", "سجل الطباعة (الإصدار الحالي)")}
          <select name="print" defaultValue={filters.print}>
            <option value="ALL">{tr(locale, "All", "الكل")}</option>
            <option value="NO_RECORD">{tr(locale, "No recorded print event", "دون حدث طباعة مسجل")}</option>
            <option value="RECORDED">{tr(locale, "Recorded print event exists", "يوجد حدث طباعة مسجل")}</option>
          </select>
        </label>
        <label>{tr(locale, "Accession (exact)", "رقم الطلب (مطابقة تامة)")}
          <input name="accession" defaultValue={filters.accession} maxLength={50}
            placeholder={tr(locale, "Accession number", "رقم الطلب")} />
        </label>
        <label>{tr(locale, "Issued from (UTC)", "تاريخ الإصدار من (UTC)")}
          <input type="date" name="from" defaultValue={dateLabels.from} />
        </label>
        <label>{tr(locale, "Issued through (UTC)", "تاريخ الإصدار إلى (UTC)")}
          <input type="date" name="to" defaultValue={dateLabels.to} />
        </label>
        <button type="submit" className="primary-button">{tr(locale, "Apply filters", "تطبيق التصفية")}</button>
      </form>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <h2>{tr(locale, "Latest Report Versions", "أحدث إصدارات التقارير")}</h2>
        <span>{shown.length} {tr(locale, "shown", "معروضة")} · {totalReports} {tr(locale, "matching", "مطابقة")}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>{tr(locale, "Accession", "رقم الطلب")}</th>
            <th>{tr(locale, "Patient", "المريض")}</th>
            <th>{tr(locale, "Branch", "الفرع")}</th>
            <th>{tr(locale, "Version", "الإصدار")}</th>
            <th>{tr(locale, "Status", "الحالة")}</th>
            <th>{tr(locale, "Print record", "سجل الطباعة")}</th>
            <th>{tr(locale, "Issued (UTC)", "تاريخ الإصدار (UTC)")}</th>
            <th>{tr(locale, "Issued by", "أصدر بواسطة")}</th>
            <th>{tr(locale, "Action", "الإجراء")}</th>
          </tr></thead>
          <tbody>
            {!shown.length ? <tr><td colSpan={9} className="empty-state">
              {tr(locale, "No reports match the selected filters.", "لا توجد تقارير تطابق معايير البحث.")}
            </td></tr> : shown.map(({report,version}) => <tr key={version.id}>
              <td><strong>{report.order.accessionNumber}</strong></td>
              <td>{reportQueuePatientIdentity(version.contentSnapshot, locale).patientNumber}<small className="table-subtext">
                {reportQueuePatientIdentity(version.contentSnapshot, locale).patientName}
              </small></td>
              <td>{locale === "ar" ? report.order.orderingBranch.nameAr ||
                report.order.orderingBranch.nameEn : report.order.orderingBranch.nameEn}</td>
              <td>{version.version}</td>
              <td>{statusLabel(locale, version.status)}</td>
              <td>{version.deliveries.length
                ? tr(locale, "Event recorded", "الحدث مسجل")
                : tr(locale, "No record", "غير مسجل")}</td>
              <td>{version.issuedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td>{locale === "ar" ? version.issuedBy.displayNameAr ||
                version.issuedBy.displayNameEn : version.issuedBy.displayNameEn}</td>
              <td><Link className="secondary-link" href={"/reports/" + report.orderId}>
                {tr(locale, "Open", "فتح")}</Link></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <nav className="result-actions" aria-label={tr(locale, "Report pages", "صفحات التقارير")}>
        {page > 1 && <Link className="secondary-link" href={reportQueueHref(filters,page-1)}>
          {tr(locale, "Previous", "السابق")}</Link>}
        <span>{tr(locale, "Page", "الصفحة")} {page} / {totalPages}</span>
        {page < totalPages && <Link className="secondary-link" href={reportQueueHref(filters,page+1)}>
          {tr(locale, "Next", "التالي")}</Link>}
      </nav>
    </section>
  </main>;
}
