import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 4).map(part => part[0]?.toUpperCase()).join("");
}

export default async function VerifyReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) notFound();

  const version = await prisma.diagnosticReportVersion.findUnique({
    where: { verificationToken: token },
    include: {
      report: {
        include: {
          order: { include: { patient: true, orderingBranch: true, organization: true } },
        },
      },
      issuedBy: true,
    },
  });
  if (!version) notFound();

  const order = version.report.order;

  return <main className="verify-report-shell">
    <section className="verify-report-card">
      <div className="verification-badge">VALID REPORT</div>
      <h1>Diagnostic Report Verification</h1>
      <p className="muted">This verification record was found in the issuing laboratory system.</p>

      <dl className="verification-grid">
        <dt>Laboratory</dt><dd>{order.organization.nameEn}</dd>
        <dt>Branch</dt><dd>{order.orderingBranch.nameEn}</dd>
        <dt>Accession</dt><dd>{order.accessionNumber}</dd>
        <dt>Patient</dt><dd>{initials(order.patient.fullNameEn)} · {order.patient.patientNumber}</dd>
        <dt>Report version</dt><dd>{version.version}</dd>
        <dt>Report status</dt><dd>{version.status}</dd>
        <dt>Issued at</dt><dd>{version.issuedAt.toISOString().replace("T"," ").slice(0,19)} UTC</dd>
        <dt>Issued by</dt><dd>{version.issuedBy.displayNameEn}</dd>
      </dl>

      {version.status === "RETRACTED" && <div className="report-amended-banner">
        <strong>RETRACTED</strong>
        <span>This report version should not be used for clinical decisions.</span>
      </div>}

      <p className="verification-note">For privacy, this public verification page shows limited patient information. The complete clinical report remains available only through authorized LIS access or the issued document.</p>
    </section>
  </main>;
}
