import { notFound } from "next/navigation";
import { requirePortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type ReportSnapshot = {
  organization?: { nameEn?: string; nameAr?: string | null };
  branch?: { nameEn?: string; nameAr?: string | null };
  patient?: { patientNumber?: string; fullNameEn?: string; fullNameAr?: string | null; dateOfBirth?: string | null; sexAtBirth?: string };
  order?: { accessionNumber?: string; orderedAt?: string; priority?: string };
  results?: Array<{
    testCode?: string;
    testNameEn?: string;
    testNameAr?: string | null;
    comments?: string | null;
    values?: Array<{
      componentCode?: string;
      componentNameEn?: string;
      componentNameAr?: string | null;
      displayValue?: string | null;
      unit?: string | null;
      flag?: string;
      referenceLow?: string | null;
      referenceHigh?: string | null;
      referenceTextEn?: string | null;
    }>;
  }>;
};

export default async function PortalReportPage({ params }: { params: Promise<{ versionId: string }> }) {
  const session = await requirePortalSession();
  const { versionId } = await params;
  const account = session.portalAccount;
  const version = await prisma.diagnosticReportVersion.findUnique({
    where: { id: versionId },
    include: { report: { include: { order: true } } },
  });
  if (!version || version.report.order.organizationId !== account.organizationId) notFound();

  const order = version.report.order;
  let allowed = false;
  if (account.type === "PATIENT") {
    allowed = order.patientId === account.patientId;
  } else if (account.type === "DOCTOR") {
    allowed = order.referrerId === account.referrerId;
  } else if (account.type === "CORPORATE" && order.clientId === account.clientId) {
    const access = await prisma.corporatePortalPatientAccess.findFirst({
      where: {
        clientId: account.clientId!,
        patientId: order.patientId,
        canViewReports: true,
        status: "ACTIVE",
        effectiveFrom: { lte: version.issuedAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: version.issuedAt } }],
      },
      select: { id: true },
    });
    allowed = Boolean(access);
  }
  if (!allowed) notFound();

  const snapshot = version.contentSnapshot as unknown as ReportSnapshot;
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Diagnostic Report · v{version.version}</p>
        <h1>{snapshot.organization?.nameEn || "Family Lab"}</h1>
        <p className="muted">{snapshot.branch?.nameEn || ""} · {version.status} · Issued {version.issuedAt.toISOString().replace("T"," ").slice(0,16)}</p>
      </div>
      <a className="secondary-link" href="/portal">Back to Portal</a>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Patient</h2><strong>{snapshot.patient?.fullNameEn || "—"}</strong><p className="muted">{snapshot.patient?.patientNumber || ""}</p></article>
      <article className="detail-card"><h2>Accession</h2><strong>{snapshot.order?.accessionNumber || "—"}</strong><p className="muted">{snapshot.order?.priority || ""}</p></article>
      <article className="detail-card"><h2>Report Version</h2><strong>v{version.version}</strong><p className="muted">{version.status}</p></article>
    </section>

    {(snapshot.results || []).map((result, index) => <section className="table-card detail-section" key={(result.testCode || "test") + index}>
      <div className="table-toolbar"><h2>{result.testCode} — {result.testNameEn}</h2></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Component</th><th>Result</th><th>Flag</th><th>Unit</th><th>Reference</th></tr></thead>
        <tbody>{(result.values || []).map((value, valueIndex) => <tr key={(value.componentCode || "component") + valueIndex}>
          <td>{value.componentCode}<br/><small>{value.componentNameEn}</small></td>
          <td><strong>{value.displayValue || "—"}</strong></td>
          <td>{value.flag || "—"}</td>
          <td>{value.unit || "—"}</td>
          <td>{value.referenceTextEn || [value.referenceLow, value.referenceHigh].filter(Boolean).join(" – ") || "—"}</td>
        </tr>)}</tbody>
      </table></div>
      {result.comments && <p className="muted">{result.comments}</p>}
    </section>)}
  </main>;
}
