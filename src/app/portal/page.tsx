import { doctorAccessWhere } from "@/lib/doctor-portal-access";
import Link from "next/link";
import { requirePortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { PortalLogoutButton } from "@/components/portal-logout-button";
import { PortalBookingForm } from "@/components/portal-booking-form";
import { PortalContactVerification } from "@/components/portal-contact-verification";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";
import { normalizePortalContactDestination } from "@/lib/report-outbound";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const session = await requirePortalSession();
  const account = session.portalAccount;
  const locale = getUiLocale(account.preferredLocale);
  const now = new Date();

  let allowedPatientIds: string[] = [];
  let reportPatientIds: string[] = [];
  let bookingPatientIds: string[] = [];

  if (account.type === "PATIENT" && account.patientId) {
    allowedPatientIds = [account.patientId];
    reportPatientIds = [account.patientId];
    bookingPatientIds = [account.patientId];
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
    bookingPatientIds = access.filter(item => item.canBook).map(item => item.patientId);
  }

  const orderWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "DOCTOR"
      ? doctorAccessWhere({ organizationId: account.organizationId, referrerId: account.referrerId!, capability: "orders", now })
      : { organizationId: account.organizationId, clientId: account.clientId!, patientId: { in: allowedPatientIds } };

  const reportOrderWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "DOCTOR"
      ? doctorAccessWhere({ organizationId: account.organizationId, referrerId: account.referrerId!, capability: "reports", now })
      : { organizationId: account.organizationId, clientId: account.clientId!, patientId: { in: reportPatientIds } };

  const appointmentWhere = account.type === "PATIENT"
    ? { organizationId: account.organizationId, patientId: account.patientId! }
    : account.type === "CORPORATE"
      ? { organizationId: account.organizationId, portalAccountId: account.id, patientId: { in: allowedPatientIds } }
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
            where: { id: { in: bookingPatientIds }, organizationId: account.organizationId, status: "ACTIVE" },
            select: { id: true, patientNumber: true, fullNameEn: true },
            orderBy: { fullNameEn: "asc" },
          })
        : Promise.resolve([]),
  ]);

  const identity =
    account.type === "PATIENT" ? account.patient?.fullNameEn :
    account.type === "DOCTOR" ? account.referrer?.nameEn :
    account.client?.nameEn;

  const currentEmailVerification = account.email
    ? account.contactVerifications.find(item =>
        item.channel === "EMAIL"
        && normalizePortalContactDestination("EMAIL", item.destinationSnapshot)
          === normalizePortalContactDestination("EMAIL", account.email!)
      ) || null
    : null;
  const currentPhoneVerification = account.phone
    ? account.contactVerifications.find(item =>
        item.channel === "PHONE"
        && normalizePortalContactDestination("PHONE", item.destinationSnapshot)
          === normalizePortalContactDestination("PHONE", account.phone!)
      ) || null
    : null;

  return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, account.type + " Portal", account.type === "PATIENT" ? "بوابة المريض" : account.type === "DOCTOR" ? "بوابة الطبيب" : "بوابة الشركات")}</p>
        <h1>{identity || "Family Lab Portal"}</h1>
        <p className="muted">{account.organization.nameEn} · {tr(locale, "Secure scoped access", "وصول آمن ومحدد الصلاحيات")}</p>
      </div>
      <PortalLogoutButton locale={locale} />
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Orders", "الطلبات")}</h2><strong>{orders.length}</strong><p className="muted">{tr(locale, "Recent authorized laboratory orders.", "أحدث طلبات المختبر المصرح بها.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Reports", "التقارير")}</h2><strong>{reports.length}</strong><p className="muted">{tr(locale, "Released report versions available to this account.", "إصدارات التقارير المتاحة لهذا الحساب.")}</p></article>
      {account.type !== "DOCTOR" && <article className="detail-card"><h2>{tr(locale, "Appointments", "المواعيد")}</h2><strong>{appointments.length}</strong><p className="muted">{tr(locale, "Onsite and home collection bookings.", "حجوزات المختبر والسحب المنزلي.")}</p></article>}
      {account.type !== "DOCTOR" && <article className="detail-card"><h2>{tr(locale, "Invoices", "الفواتير")}</h2><strong>{invoices.length}</strong><p className="muted">{tr(locale, "Financial records within portal scope.", "السجلات المالية ضمن صلاحية البوابة.")}</p></article>}
    </section>

    <PortalContactVerification
      email={account.email}
      phone={account.phone}
      emailVerifiedAt={currentEmailVerification?.verifiedAt.toISOString() || null}
      phoneVerifiedAt={currentPhoneVerification?.verifiedAt.toISOString() || null}
      locale={locale}
    />

    {account.type !== "DOCTOR" && <PortalBookingForm
      branches={bookingBranches.map(branch => ({ id: branch.id, name: branch.nameEn || branch.nameAr || "Branch" }))}
      patients={bookingPatients.map(patient => ({ id: patient.id, label: patient.patientNumber + " — " + patient.fullNameEn }))}
      locale={locale}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Orders & Status", "الطلبات والحالات")}</h2><span>{orders.length} {tr(locale, "shown", "معروض")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th>{account.type !== "PATIENT" && <th>{tr(locale, "Patient", "المريض")}</th>}<th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Ordered", "تاريخ الطلب")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th></tr></thead>
        <tbody>{orders.length === 0 ? <tr><td colSpan={account.type === "PATIENT" ? 5 : 6} className="empty-state">{tr(locale, "No authorized orders.", "لا توجد طلبات مصرح بها.")}</td></tr> : orders.map(order => <tr key={order.id}>
          <td><strong>{order.accessionNumber}</strong></td>
          {account.type !== "PATIENT" && <td>{order.patient.fullNameEn}<br/><small>{order.patient.patientNumber}</small></td>}
          <td>{order.orderingBranch.nameEn}</td>
          <td>{order.orderedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{statusLabel(locale, order.status)}</td>
          <td>{order.items.map(item => item.testCodeSnapshot).join(", ")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Reports", "التقارير")}</h2><span>{reports.length} {tr(locale, "versions", "إصدارات")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th>{account.type !== "PATIENT" && <th>{tr(locale, "Patient", "المريض")}</th>}<th>{tr(locale, "Version", "الإصدار")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Issued", "تاريخ الإصدار")}</th><th></th></tr></thead>
        <tbody>{reports.length === 0 ? <tr><td colSpan={account.type === "PATIENT" ? 5 : 6} className="empty-state">{tr(locale, "No released reports available.", "لا توجد تقارير صادرة متاحة.")}</td></tr> : reports.map(report => <tr key={report.id}>
          <td>{report.report.order.accessionNumber}</td>
          {account.type !== "PATIENT" && <td>{report.report.order.patient.fullNameEn}</td>}
          <td>v{report.version}</td>
          <td>{statusLabel(locale, report.status)}</td>
          <td>{report.issuedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td><Link className="secondary-link" href={"/portal/reports/" + report.id}>{tr(locale, "View", "عرض")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {account.type !== "DOCTOR" && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Appointments", "المواعيد")}</h2><span>{appointments.length} {tr(locale, "shown", "معروض")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Booking", "الحجز")}</th>{account.type === "CORPORATE" && <th>{tr(locale, "Patient", "المريض")}</th>}<th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Mode", "النوع")}</th><th>{tr(locale, "Scheduled", "الموعد")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{appointments.length === 0 ? <tr><td colSpan={account.type === "CORPORATE" ? 6 : 5} className="empty-state">{tr(locale, "No appointments.", "لا توجد مواعيد.")}</td></tr> : appointments.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td>
          {account.type === "CORPORATE" && <td>{item.patient.fullNameEn}</td>}
          <td>{item.branch.nameEn}</td>
          <td>{item.mode}</td>
          <td>{item.scheduledStart.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{statusLabel(locale, item.homeCollectionVisit ? item.homeCollectionVisit.status : item.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {account.type !== "DOCTOR" && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Invoices / Statements", "الفواتير / الكشوفات")}</h2><span>{invoices.length} {tr(locale, "shown", "معروض")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Issued", "تاريخ الإصدار")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Total", "الإجمالي")}</th><th>{tr(locale, "Paid", "المدفوع")}</th><th>{tr(locale, "Balance", "الرصيد")}</th></tr></thead>
        <tbody>{invoices.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No invoices in portal scope.", "لا توجد فواتير ضمن صلاحية البوابة.")}</td></tr> : invoices.map(invoice => <tr key={invoice.id}>
          <td>{invoice.invoiceNumber}</td>
          <td>{invoice.issuedAt.toISOString().slice(0,10)}</td>
          <td>{statusLabel(locale, invoice.status)}</td>
          <td>{invoice.total.toString()} {invoice.currency}</td>
          <td>{invoice.paidAmount.toString()} {invoice.currency}</td>
          <td>{invoice.balanceAmount.toString()} {invoice.currency}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}
