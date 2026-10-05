import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyCaseEditor } from "@/components/microbiology-case-editor";

export const dynamic = "force-dynamic";

export default async function MicrobiologyCasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.view");
  const permissions = permissionSet(session);
  const { id } = await params;
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const microbiologyCase = await prisma.microbiologyCase.findFirst({
    where: {
      id,
      organizationId: session.user.organizationId,
      performingBranchId: { in: branchIds },
    },
    include: {
      performingBranch: true,
      specimen: { include: { specimenType: true, container: true } },
      orderItem: {
        include: {
          test: true,
          order: { include: { patient: true, orderingBranch: true } },
        },
      },
      createdBy: true,
      finalizedBy: true,
      observations: {
        include: { enteredBy: true },
        orderBy: { observedAt: "asc" },
      },
      isolates: {
        include: {
          organism: true,
          susceptibilityTests: {
            include: {
              enteredBy: true,
              results: { include: { antibiotic: true }, orderBy: { antibioticCodeSnapshot: "asc" } },
            },
            orderBy: { testedAt: "asc" },
          },
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });

  if (!microbiologyCase) notFound();

  const [organisms, antibiotics] = await Promise.all([
    prisma.organism.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.antibiotic.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const locked = ["FINAL","CANCELLED"].includes(microbiologyCase.status);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Microbiology Case</p>
        <h1>{microbiologyCase.orderItem.test.code} — {microbiologyCase.orderItem.test.nameEn}</h1>
        <p className="muted">{microbiologyCase.orderItem.order.accessionNumber} · {microbiologyCase.orderItem.order.patient.patientNumber} · {microbiologyCase.orderItem.order.patient.fullNameEn}</p>
      </div>
      <Link className="secondary-link" href="/microbiology">Back to Microbiology</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Patient & Order</h2>
        <dl>
          <dt>Patient</dt><dd>{microbiologyCase.orderItem.order.patient.fullNameEn}</dd>
          <dt>Date of birth</dt><dd>{microbiologyCase.orderItem.order.patient.dateOfBirth?.toISOString().slice(0,10) || "—"}</dd>
          <dt>Sex at birth</dt><dd>{microbiologyCase.orderItem.order.patient.sexAtBirth}</dd>
          <dt>Accession</dt><dd>{microbiologyCase.orderItem.order.accessionNumber}</dd>
          <dt>Ordering branch</dt><dd>{microbiologyCase.orderItem.order.orderingBranch.nameEn}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>Case & Specimen</h2>
        <dl>
          <dt>Case status</dt><dd>{microbiologyCase.status}</dd>
          <dt>Culture status</dt><dd>{microbiologyCase.cultureStatus}</dd>
          <dt>Performing branch</dt><dd>{microbiologyCase.performingBranch.nameEn}</dd>
          <dt>Barcode</dt><dd><strong>{microbiologyCase.specimen.barcode}</strong></dd>
          <dt>Specimen</dt><dd>{microbiologyCase.specimen.specimenType?.nameEn || "—"}</dd>
          <dt>Container</dt><dd>{microbiologyCase.specimen.container?.nameEn || "—"}</dd>
        </dl>
      </article>
    </section>

    {!locked && permissions.has("microbiology.enter") && <MicrobiologyCaseEditor
      caseId={microbiologyCase.id}
      cultureStatus={microbiologyCase.cultureStatus}
      preliminaryComment={microbiologyCase.preliminaryComment || ""}
      organisms={organisms}
      antibiotics={antibiotics}
      isolates={microbiologyCase.isolates.map(item => ({
        id: item.id,
        sequenceNumber: item.sequenceNumber,
        organismCode: item.organism.code,
        organismName: item.organism.nameEn,
      }))}
    />}

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Culture Observations</h2><span>{microbiologyCase.observations.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Type</th><th>Observation</th><th>Entered by</th></tr></thead>
          <tbody>{microbiologyCase.observations.length === 0 ? <tr><td colSpan={4} className="empty-state">No culture observations recorded.</td></tr> : microbiologyCase.observations.map(item => <tr key={item.id}>
            <td>{item.observedAt.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{item.observationType}</td>
            <td>{item.observationText}</td>
            <td>{item.enteredBy.displayNameEn}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="detail-card">
        <h2>Interpretive Comments</h2>
        <dl>
          <dt>Preliminary</dt><dd>{microbiologyCase.preliminaryComment || "—"}</dd>
          <dt>Final</dt><dd>{microbiologyCase.finalComment || "Not finalized"}</dd>
          <dt>Created by</dt><dd>{microbiologyCase.createdBy.displayNameEn}</dd>
          <dt>Finalized by</dt><dd>{microbiologyCase.finalizedBy?.displayNameEn || "—"}</dd>
        </dl>
        <p className="muted">Finalization is intentionally unavailable until this case is linked into the normal versioned LaboratoryResult validation/release/report workflow.</p>
      </article>
    </section>

    <section className="detail-section">
      <h2>Isolates & Susceptibility</h2>
      {microbiologyCase.isolates.length === 0 ? <div className="detail-card"><p className="empty-state">No organisms isolated.</p></div> :
        microbiologyCase.isolates.map(isolate => <article className="detail-card detail-section" key={isolate.id}>
          <h3>Isolate #{isolate.sequenceNumber}: {isolate.organism.code} — {isolate.organism.nameEn}</h3>
          <p className="muted">{isolate.quantityText || "Quantity not specified"}{isolate.colonyNotes ? " · " + isolate.colonyNotes : ""}</p>
          {isolate.susceptibilityTests.length === 0 ? <p className="empty-state">No susceptibility panel recorded.</p> :
            isolate.susceptibilityTests.map(test => <div className="table-wrap" key={test.id}>
              <p><strong>{test.method || "Method not specified"}</strong> · {test.testedAt.toISOString().replace("T"," ").slice(0,19)} · {test.enteredBy.displayNameEn}</p>
              <table>
                <thead><tr><th>Antibiotic</th><th>S/I/R</th><th>MIC</th><th>Zone</th><th>Breakpoint snapshot</th></tr></thead>
                <tbody>{test.results.map(result => <tr key={result.id}>
                  <td><strong>{result.antibioticCodeSnapshot}</strong><br/><small>{result.antibioticNameEnSnapshot}</small></td>
                  <td>{result.interpretation}</td>
                  <td>{result.micValue?.toString() || "—"}{result.micUnit ? " " + result.micUnit : ""}</td>
                  <td>{result.zoneDiameterMm !== null ? result.zoneDiameterMm.toString() + " mm" : "—"}</td>
                  <td>{result.breakpointSnapshot || "—"}</td>
                </tr>)}</tbody>
              </table>
              {test.comments && <p>{test.comments}</p>}
            </div>)}
        </article>)}
    </section>
  </main>;
}
