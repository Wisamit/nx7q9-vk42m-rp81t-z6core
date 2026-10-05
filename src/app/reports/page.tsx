import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requirePermission("reports.view");
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
        <p className="eyebrow">Reporting</p>
        <h1>Diagnostic Reports</h1>
        <p className="muted">Released report versions are immutable. New releases and amendments create new versions instead of changing history.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <section className="table-card">
      <div className="table-toolbar"><h2>Released Reports</h2><span>{reports.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Accession</th><th>Patient</th><th>Branch</th><th>Version</th><th>Type</th><th>Issued</th><th>Issued by</th><th></th></tr></thead>
          <tbody>
            {reports.length === 0 ? <tr><td colSpan={8} className="empty-state">No released diagnostic reports yet.</td></tr> :
              reports.map(report => {
                const version = report.versions[0];
                return <tr key={report.id}>
                  <td><strong>{report.order.accessionNumber}</strong></td>
                  <td>{report.order.patient.patientNumber}<br/><small>{report.order.patient.fullNameEn}</small></td>
                  <td>{report.order.orderingBranch.nameEn}</td>
                  <td>{version?.version || report.currentVersion}</td>
                  <td>{version?.status || "—"}</td>
                  <td>{version?.issuedAt.toISOString().replace("T"," ").slice(0,19) || "—"}</td>
                  <td>{version?.issuedBy.displayNameEn || "—"}</td>
                  <td><Link className="secondary-link" href={`/reports/${report.orderId}`}>Open</Link></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
