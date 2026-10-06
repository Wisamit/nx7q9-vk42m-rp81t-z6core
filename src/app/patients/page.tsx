import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PatientCreateModal } from "@/components/patient-create-modal";
import { SystemIcon } from "@/components/system-icon";

export const dynamic = "force-dynamic";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("patients.view");
  const query = (await searchParams).q?.trim() || "";

  const patients = await prisma.patient.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(query ? {
        OR: [
          { patientNumber: { contains: query } },
          { fullNameEn: { contains: query } },
          { fullNameAr: { contains: query } },
          { phone: { contains: query } },
          { email: { contains: query } },
          { identifiers: { some: { value: { contains: query }, status: "ACTIVE" } } },
        ],
      } : {}),
    },
    include: { identifiers: { where: { status: "ACTIVE" }, take: 3 } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Patient Registry</p>
        <h1 className="page-title-with-icon"><SystemIcon name="patients" size={25} />Patients</h1>
        <p className="muted">Organization-wide patient identity shared across all branches, with duplicate protection and auditable identifiers.</p>
      </div>
      <div className="header-actions">
        <PatientCreateModal />
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />Back to Dashboard</Link>
      </div>
    </header>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>Patient Search</h2><span>{patients.length} shown</span></div>
        <form className="inline-search" action="/patients" method="get">
          <input name="q" defaultValue={query} placeholder="Patient #, name, phone, ID…" />
          <button className="secondary-button"><SystemIcon name="search" size={15} />Search</button>
          {query && <Link className="secondary-link" href="/patients">Clear</Link>}
        </form>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patient #</th><th>Name</th><th>Date of birth</th><th>Sex</th><th>Phone</th><th>National ID</th><th>Status</th></tr></thead>
          <tbody>
            {patients.length === 0 ? <tr><td colSpan={7} className="empty-state">No matching patients.</td></tr> :
              patients.map(patient => <tr key={patient.id}>
                <td><Link className="table-link" href={`/patients/${patient.id}`}><strong>{patient.patientNumber}</strong></Link></td>
                <td><Link className="table-link" href={`/patients/${patient.id}`}>{patient.fullNameEn}</Link>{patient.fullNameAr ? <><br/><small dir="rtl">{patient.fullNameAr}</small></> : null}</td>
                <td>{patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0,10) : "—"}</td>
                <td>{patient.sexAtBirth}</td>
                <td>{patient.phone || "—"}</td>
                <td>{patient.identifiers.find(i => i.identifierType === "NATIONAL_ID")?.value || "—"}</td>
                <td>{patient.status}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
