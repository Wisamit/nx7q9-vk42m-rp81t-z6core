import Link from "next/link";
import { requirePortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { PortalLogoutButton } from "@/components/portal-logout-button";
import { PortalBookingForm } from "@/components/portal-booking-form";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const session = await requirePortalSession();
  const account = session.portalAccount;
  const now = new Date();

  let allowedPatientIds: string[] = [];
  let reportPatientIds: string[] = [];

  if (account.type === "PATIENT" && account.patientId) {
    allowedPatientIds = [account.patientId];
    reportPatientIds = [account.patientId];
  } else if (account.type === "CORPORATE" && account.clientId) {
    const access = await prisma.corporatePortalPatientAccess.findMany({
      where: {
        clientId: account.clientId,
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      select: { patientId: true, canViewReports: true, canBook: true },
    });
    allowedPatientIds = access.filter(item => item.canBook || item.canViewReports).map(item => item.patientId);
    reportPatientIds = access.filter(item => item.canViewReports).map(item => item.patientId);
  }

  const orderWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "DOCTOR"
      ? { organizationId: account.organizationId, referrerId: account.referrerId! }
      : { organizationId: account.organizationId, clientId: account.clientId!, patientId: { in: allowedPatientIds } };

  const reportOrderWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "DOCTOR"
      ? { organizationId: account.organizationId, referrerId: account.referrerId! }
      : { organizationId: account.organizationId, clientId: account.clientId!, patientId: { in: reportPatientIds } };

  const appointmentWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "CORPORATE"
      ? { organizationId: account.organizationId, patientId: { in: allowedPatientIds } }
      : { organizationId: account.organizationId, id: "__none__" };

  const [orders, reports, appointments, invoices, bookingBranches, bookingPatients] = await Promise.all([
    prisma.labOrder.findMany({
      where: orderWhere,
      include: {
        orderingBranch: true,
        patient: true,
        items: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { orderedAt: "desc" },
      take: 100,
    }),
    prisma.diagnosticReportVersion.findMany({
      where: { report: { order: reportOrderWhere } },
      include: {
        report: { include: { order: { include: { patient: true } } } },
        branch: true,
      },
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
    prisma.appointment.findMany({
      where: appointmentWhere,
      include: { branch: true, patient: true, homeCollectionVisit: true },
      orderBy: { scheduledStart: "desc" },
      take: 100,
    }),
    account.type === "PATIENT"
      ? prisma.invoice.findMany({
          where: { organizationId: account.organizationId, order: { patientId: account.patientId! } },
          include: { order: true },
          orderBy: { issuedAt: "desc" },
          take: 100,
        })
      : account.type === "CORPORATE"
        ? prisma.invoice.findMany({
            where: { organizationId: account.organizationId, clientId: account.clientId! },
            include: { order: true },
            orderBy: { issuedAt: "desc" },
            take: 100,
          })
        : Promise.resolve([]),
    account.type === "DOCTOR"
      ? Promise.resolve([])
      : prisma.branch.findMany({
          where: { organizationId: account.organizationId, status: "ACTIVE" },
          select: { id: true, nameEn: true, nameAr: true },
          orderBy: { nameEn: "asc" },
        }),
    account.type === "PATIENT"
      ? prisma.patient.findMany({
          where: { id: account.patientId!, organizationId: account.organizationId, status: "ACTIVE" },
          select: { id: true, patientNumber: true, fullNameEn: true },
        })
      : account.type === "CORPORATE"
        ? prisma.patient.findMany({
            where: { id: { in: allowedPatientIds }, organizationId: account.organizationId, status: "ACTIVE" },
            select: { id: true, patientNumber: true, fullNameEn: true },
            orderBy: { fullNameEn: "asc" },
          })
        : Promise.resolve([]),
  ]);

  const identity =
    account.type === "PATIENT" ? account.patient?.fullNameEn :
    account.type === "DOCTOR" ? account.referrer?.nameEn :
    account.client?.nameEn;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{account.type} Portal</p>
        <h1>{identity || "Family Lab Portal"}</h1>
        <p className="muted">{account.organization.nameEn} · Secure scoped access</p>
      </div>
      <PortalLogoutButton />
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>Orders</h2><strong>{orders.length}</strong><p className="muted">Recent authorized laboratory orders.</p></article>
      <article className="detail-card"><h2>Reports</h2><strong>{reports.length}</strong><p className="muted">Released report versions available to this account.</p></article>
      {account.type !== "DOCTOR" && <article className="detail-card"><h2>Appointments</h2><strong>{appointments.length}</strong><p className="muted">Onsite and home collection bookings.</p></article>}
      {account.type !== "DOCTOR" && <article className="detail-card"><h2>Invoices</h2><strong>{invoices.length}</strong><p className="muted">Financial records within portal scope.</p></article>}
    </section>

    {account.type !== "DOCTOR" && <PortalBookingForm
      branches={bookingBranches.map(branch => ({ id: branch.id, name: branch.nameEn || branch.nameAr || "Branch" }))}
      patients={bookingPatients.map(patient => ({ id: patient.id, label: patient.patientNumber + " — " + patient.fullNameEn }))}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Orders & Status</h2><span>{orders.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Accession</th>{account.type !== "PATIENT" && <th>Patient</th>}<th>Branch</th><th>Ordered</th><th>Status</th><th>Tests</th></tr></thead>
        <tbody>{orders.length === 0 ? <tr><td colSpan={account.type === "PATIENT" ? 5 : 6} className="empty-state">No authorized orders.</td></tr> : orders.map(order => <tr key={order.id}>
          <td><strong>{order.accessionNumber}</strong></td>
          {account.type !== "PATIENT" && <td>{order.patient.fullNameEn}<br/><small>{order.patient.patientNumber}</small></td>}
          <td>{order.orderingBranch.nameEn}</td>
          <td>{order.orderedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{order.status}</td>
          <td>{order.items.map(item => item.testCodeSnapshot).join(", ")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Reports</h2><span>{reports.length} versions</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Accession</th>{account.type !== "PATIENT" && <th>Patient</th>}<th>Version</th><th>Status</th><th>Issued</th><th></th></tr></thead>
        <tbody>{reports.length === 0 ? <tr><td colSpan={account.type === "PATIENT" ? 5 : 6} className="empty-state">No released reports available.</td></tr> : reports.map(report => <tr key={report.id}>
          <td>{report.report.order.accessionNumber}</td>
          {account.type !== "PATIENT" && <td>{report.report.order.patient.fullNameEn}</td>}
          <td>v{report.version}</td>
          <td>{report.status}</td>
          <td>{report.issuedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td><Link className="secondary-link" href={"/portal/reports/" + report.id}>View</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {account.type !== "DOCTOR" && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Appointments</h2><span>{appointments.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Booking</th>{account.type === "CORPORATE" && <th>Patient</th>}<th>Branch</th><th>Mode</th><th>Scheduled</th><th>Status</th></tr></thead>
        <tbody>{appointments.length === 0 ? <tr><td colSpan={account.type === "CORPORATE" ? 6 : 5} className="empty-state">No appointments.</td></tr> : appointments.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td>
          {account.type === "CORPORATE" && <td>{item.patient.fullNameEn}</td>}
          <td>{item.branch.nameEn}</td>
          <td>{item.mode}</td>
          <td>{item.scheduledStart.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{item.homeCollectionVisit ? item.homeCollectionVisit.status : item.status}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {account.type !== "DOCTOR" && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Invoices / Statements</h2><span>{invoices.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Issued</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
        <tbody>{invoices.length === 0 ? <tr><td colSpan={6} className="empty-state">No invoices in portal scope.</td></tr> : invoices.map(invoice => <tr key={invoice.id}>
          <td>{invoice.invoiceNumber}</td>
          <td>{invoice.issuedAt.toISOString().slice(0,10)}</td>
          <td>{invoice.status}</td>
          <td>{invoice.total.toString()} {invoice.currency}</td>
          <td>{invoice.paidAmount.toString()} {invoice.currency}</td>
          <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}
