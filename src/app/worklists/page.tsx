import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function WorklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; department?: string }>;
}) {
  const session = await requirePermission("worklists.view");
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const departmentId = params.department?.trim() || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [items, departments] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: { organizationId: session.user.organizationId },
        status: { not: "CANCELLED" },
        specimenLinks: {
          some: {
            specimen: {
              currentBranchId: { in: branchIds },
              status: { in: ["RECEIVED","IN_PROCESS"] },
            },
          },
        },
        ...(status && ["ORDERED","COLLECTED","IN_PROGRESS","RESULTED","VERIFIED"].includes(status)
          ? { status: status as "ORDERED" | "COLLECTED" | "IN_PROGRESS" | "RESULTED" | "VERIFIED" }
          : {}),
        ...(departmentId ? { test: { departmentId } } : {}),
        ...(q ? {
          AND: [{
            OR: [
              { testCodeSnapshot: { contains: q } },
              { testNameEnSnapshot: { contains: q } },
              { order: { accessionNumber: { contains: q } } },
              { order: { patient: { patientNumber: { contains: q } } } },
              { order: { patient: { fullNameEn: { contains: q } } } },
              { specimenLinks: { some: { specimen: { barcode: { contains: q } } } } },
            ],
          }],
        } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        test: { include: { department: true } },
        performedBranch: true,
        specimenLinks: {
          include: { specimen: { include: { currentBranch: true } } },
          orderBy: { createdAt: "desc" },
        },
        results: {
          orderBy: { version: "desc" },
          take: 1,
          include: { values: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
    prisma.department.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const pendingEntry = items.filter(item => !item.results[0]).length;
  const inProgress = items.filter(item => item.results[0] && !["VERIFIED","RELEASED","AMENDED"].includes(item.results[0].status)).length;
  const verified = items.filter(item => item.results[0]?.status === "VERIFIED").length;
  const critical = items.filter(item => item.results[0]?.values.some(value => value.isCritical)).length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Laboratory Operations</p>
        <h1>Worklists</h1>
        <p className="muted">Received specimens ready for analytical work, result entry and controlled verification.</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens">Specimens</Link>
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>Awaiting entry</span><strong>{pendingEntry}</strong><small>received tests without result</small></article>
      <article><span>In progress</span><strong>{inProgress}</strong><small>entered / under review</small></article>
      <article><span>Verified</span><strong>{verified}</strong><small>ready for release workflow</small></article>
      <article className={critical ? "summary-attention" : ""}><span>Critical</span><strong>{critical}</strong><small>items containing critical values</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>Laboratory Work Queue</h2><span>{items.length} item(s)</span></div>
        <form className="inline-search" action="/worklists" method="get">
          <input name="q" defaultValue={q} placeholder="Barcode, accession, patient, test…" />
          <select name="department" defaultValue={departmentId}>
            <option value="">All departments</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.code} — {department.nameEn}</option>)}
          </select>
          <select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="COLLECTED">COLLECTED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="RESULTED">RESULTED</option>
            <option value="VERIFIED">VERIFIED</option>
          </select>
          <button className="secondary-button">Filter</button>
          {(q || status || departmentId) && <Link className="secondary-link" href="/worklists">Clear</Link>}
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Accession</th><th>Patient</th><th>Test</th><th>Department</th><th>Specimen</th><th>Location</th><th>Result</th><th>Flags</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={9} className="empty-state">No received specimens are waiting for laboratory work.</td></tr> :
              items.map(item => {
                const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen => ["RECEIVED","IN_PROCESS"].includes(specimen.status));
                const result = item.results[0];
                const criticalCount = result?.values.filter(value => value.isCritical).length || 0;
                const abnormalCount = result?.values.filter(value => ["LOW","HIGH","CRITICAL_LOW","CRITICAL_HIGH","ABNORMAL"].includes(value.flag)).length || 0;
                return <tr key={item.id}>
                  <td><strong>{item.order.accessionNumber}</strong></td>
                  <td>{item.order.patient.patientNumber}<br/><small>{item.order.patient.fullNameEn}</small></td>
                  <td><strong>{item.testCodeSnapshot}</strong><br/><small>{item.testNameEnSnapshot}</small></td>
                  <td>{item.test.department?.nameEn || "Unassigned"}</td>
                  <td><span className="barcode-text">{readySpecimen?.barcode || "—"}</span><br/><small>{readySpecimen?.status || "—"}</small></td>
                  <td>{readySpecimen?.currentBranch?.nameEn || item.performedBranch?.nameEn || "—"}</td>
                  <td><span className={"status-badge status-" + (result?.status || item.status).toLowerCase().replaceAll("_","-")}>{result?.status || item.status}</span></td>
                  <td>{criticalCount > 0 ? <strong className="critical-text">{criticalCount} critical</strong> : abnormalCount > 0 ? `${abnormalCount} flagged` : "—"}</td>
                  <td><Link className="secondary-link" href={`/worklists/${item.id}`}>{result ? "Open Result" : "Enter Result"}</Link></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
