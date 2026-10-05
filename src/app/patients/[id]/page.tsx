import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.view");
  const { id } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { identifiers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!patient) notFound();

  const duplicateCandidates = await prisma.patient.findMany({
    where: {
      organizationId: session.user.organizationId,
      id: { not: patient.id },
      status: "ACTIVE",
      OR: [
        { normalizedName: patient.normalizedName, ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}) },
        ...(patient.normalizedPhone ? [{ normalizedPhone: patient.normalizedPhone }] : []),
      ],
    },
    select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true, dateOfBirth: true, phone: true },
    take: 10,
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Patient Record</p>
        <h1>{patient.fullNameEn}</h1>
        <p className="muted">{patient.patientNumber} · Organization-wide identity</p>
      </div>
      <Link className="secondary-link" href="/patients">Back to Patients</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Demographics</h2>
        <dl>
          <dt>Patient #</dt><dd>{patient.patientNumber}</dd>
          <dt>English name</dt><dd>{patient.fullNameEn}</dd>
          <dt>Arabic name</dt><dd dir="rtl">{patient.fullNameAr || "—"}</dd>
          <dt>Date of birth</dt><dd>{patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0,10) : "—"}</dd>
          <dt>Sex at birth</dt><dd>{patient.sexAtBirth}</dd>
          <dt>Phone</dt><dd>{patient.phone || "—"}</dd>
          <dt>Email</dt><dd>{patient.email || "—"}</dd>
          <dt>Nationality</dt><dd>{patient.nationalityCode || "—"}</dd>
          <dt>Status</dt><dd>{patient.status}</dd>
        </dl>
      </article>

      <article className="detail-card">
        <h2>Identifiers</h2>
        {patient.identifiers.length === 0 ? <p className="muted">No external identifiers recorded.</p> :
          <div className="summary-list">{patient.identifiers.map(identifier =>
            <div key={identifier.id}><span>{identifier.identifierType}{identifier.isPrimary ? " · Primary" : ""}</span><strong>{identifier.value}</strong></div>
          )}</div>}
      </article>
    </section>

    <section className="detail-card">
      <h2>Potential Duplicates</h2>
      <p className="muted">Candidates are shown for review only. No patient records are merged or deleted automatically.</p>
      {duplicateCandidates.length === 0 ? <p className="muted">No likely duplicates found.</p> :
        <div className="summary-list">{duplicateCandidates.map(candidate =>
          <div key={candidate.id}>
            <span><Link className="table-link" href={`/patients/${candidate.id}`}>{candidate.patientNumber} · {candidate.fullNameEn}</Link></span>
            <strong>{candidate.dateOfBirth ? candidate.dateOfBirth.toISOString().slice(0,10) : "DOB —"} · {candidate.phone || "Phone —"}</strong>
          </div>
        )}</div>}
    </section>
  </main>;
}
