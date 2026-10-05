import Link from "next/link";
import { redirect } from "next/navigation";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DigitalServicesConsole } from "@/components/digital-services-console";

export const dynamic = "force-dynamic";

export default async function DigitalServicesPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const canOpen = [
    "portal_accounts.manage",
    "appointments.view",
    "appointments.manage",
    "home_collection.view",
    "home_collection.manage",
    "queue.view",
    "queue.manage",
  ].some(code => permissions.has(code));
  if (!canOpen) redirect("/dashboard?forbidden=1");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const now = new Date();

  const [branches, patients, referrers, clients, users, portalAccounts, corporateAccess, appointments, homeCollections, queueTickets] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.patient.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, patientNumber: true, fullNameEn: true },
      orderBy: { fullNameEn: "asc" },
      take: 1000,
    }),
    prisma.referrer.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
      take: 1000,
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
      take: 1000,
    }),
    prisma.user.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        branchScopes: { some: { branchId: { in: branchIds } } },
      },
      select: { id: true, displayNameEn: true, username: true },
      orderBy: { displayNameEn: "asc" },
      take: 1000,
    }),
    prisma.portalAccount.findMany({
      where: { organizationId: session.user.organizationId },
      include: { patient: true, referrer: true, client: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.corporatePortalPatientAccess.findMany({
      where: { client: { organizationId: session.user.organizationId } },
      include: { client: true, patient: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.appointment.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: { patient: true, branch: true },
      orderBy: { scheduledStart: "desc" },
      take: 300,
    }),
    prisma.homeCollectionVisit.findMany({
      where: { branchId: { in: branchIds }, appointment: { organizationId: session.user.organizationId } },
      include: { appointment: { include: { patient: true } }, branch: true, assignedCollector: true },
      orderBy: { appointment: { scheduledStart: "desc" } },
      take: 300,
    }),
    prisma.queueTicket.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        issuedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      },
      include: { patient: true, branch: true },
      orderBy: [{ priority: "desc" }, { issuedAt: "asc" }],
      take: 500,
    }),
  ]);

  const activeQueue = queueTickets.filter(item => !["COMPLETED","CANCELLED","NO_SHOW"].includes(item.status)).length;
  const pendingAppointments = appointments.filter(item => ["REQUESTED","CONFIRMED","CHECKED_IN"].includes(item.status)).length;
  const activeHome = homeCollections.filter(item => !["DELIVERED","CANCELLED"].includes(item.status)).length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Digital Services</p>
        <h1>Portals, Appointments & Queue</h1>
        <p className="muted">Scoped external accounts, onsite and home collection bookings, and branch reception/phlebotomy queue operations.</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/portal/login">Portal sign-in</Link>
        {branches.slice(0,3).map(branch => <Link key={branch.id} className="secondary-link" href={"/queue-display/" + branch.id}>{branch.code} Queue Display</Link>)}
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Portal Accounts</h2><strong>{portalAccounts.length}</strong><p className="muted">Patient, doctor and corporate identities.</p></article>
      <article className="detail-card"><h2>Pending Appointments</h2><strong>{pendingAppointments}</strong><p className="muted">Requested, confirmed or checked in.</p></article>
      <article className="detail-card"><h2>Active Home Collection</h2><strong>{activeHome}</strong><p className="muted">Visits not yet delivered or cancelled.</p></article>
      <article className="detail-card"><h2>Queue Waiting/Serving</h2><strong>{activeQueue}</strong><p className="muted">Reception and phlebotomy queue today.</p></article>
    </section>

    <DigitalServicesConsole
      permissions={{
        portalAccounts: permissions.has("portal_accounts.manage"),
        appointments: permissions.has("appointments.manage"),
        homeCollection: permissions.has("home_collection.manage"),
        queue: permissions.has("queue.manage"),
      }}
      branches={branches}
      patients={patients.map(item => ({ id: item.id, label: item.patientNumber + " — " + item.fullNameEn }))}
      referrers={referrers.map(item => ({ id: item.id, label: item.code + " — " + item.nameEn }))}
      clients={clients.map(item => ({ id: item.id, label: item.code + " — " + item.nameEn }))}
      users={users.map(item => ({ id: item.id, label: item.displayNameEn + " (" + item.username + ")" }))}
      portalAccounts={portalAccounts.map(item => ({
        id: item.id,
        type: item.type,
        subject: item.patient?.fullNameEn || item.referrer?.nameEn || item.client?.nameEn || "—",
        contact: item.email || item.phone || "—",
        status: item.status,
        mustChangePassword: item.mustChangePassword,
      }))}
      corporateAccess={corporateAccess.map(item => ({
        id: item.id,
        client: item.client.code + " — " + item.client.nameEn,
        patient: item.patient.patientNumber + " — " + item.patient.fullNameEn,
        employeeNumber: item.employeeNumber,
        canBook: item.canBook,
        canViewReports: item.canViewReports,
        effectiveFrom: item.effectiveFrom.toISOString(),
        effectiveTo: item.effectiveTo?.toISOString() || null,
        status: item.status,
      }))}
      appointments={appointments.map(item => ({
        id: item.id,
        appointmentNumber: item.appointmentNumber,
        patient: item.patient.fullNameEn,
        branch: item.branch.nameEn,
        mode: item.mode,
        scheduledStart: item.scheduledStart.toISOString(),
        status: item.status,
      }))}
      homeCollections={homeCollections.map(item => ({
        id: item.id,
        appointmentNumber: item.appointment.appointmentNumber,
        patient: item.appointment.patient.fullNameEn,
        branch: item.branch.nameEn,
        collector: item.assignedCollector?.displayNameEn || null,
        status: item.status,
        scheduledStart: item.appointment.scheduledStart.toISOString(),
      }))}
      queueTickets={queueTickets.map(item => ({
        id: item.id,
        ticketNumber: item.ticketNumber,
        patient: item.patient.fullNameEn,
        branch: item.branch.nameEn,
        stage: item.stage,
        status: item.status,
        priority: item.priority,
        counterLabel: item.counterLabel,
        issuedAt: item.issuedAt.toISOString(),
      }))}
    />
  </main>;
}
