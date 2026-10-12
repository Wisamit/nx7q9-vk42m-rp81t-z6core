import Link from "next/link";
import { redirect } from "next/navigation";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DigitalServicesConsole } from "@/components/digital-services-console";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function DigitalServicesPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
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
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.patient.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true },
      orderBy: { fullNameEn: "asc" },
      take: 1000,
    }),
    prisma.referrer.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
      take: 1000,
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
      take: 1000,
    }),
    prisma.user.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        branchScopes: { some: { branchId: { in: branchIds } } },
      },
      select: { id: true, displayNameEn: true, displayNameAr: true, username: true },
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
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) =>
    locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const namedEntity = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) =>
    locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Digital Services", "الخدمات الرقمية")}</p>
        <h1>{tr(locale, "Portals, Appointments & Queue", "البوابات والمواعيد والطوابير")}</h1>
        <p className="muted">{tr(locale, "Scoped external accounts, onsite and home collection bookings, and branch reception/phlebotomy queue operations.", "حسابات خارجية محددة الصلاحيات، وحجوزات داخل المختبر وسحب منزلي، وإدارة طوابير الاستقبال وسحب الدم في الفروع.")}</p>
      </div>
      <div className="result-actions">
        <Link className="secondary-link" href="/portal/login">{tr(locale, "Portal sign-in", "تسجيل دخول البوابة")}</Link>
        {permissions.has("portal_accounts.manage") && <Link className="secondary-link" href="/doctor-portal-access">{tr(locale, "Doctor Patient Access", "تفويض الطبيب للمرضى")}</Link>}
        {branches.slice(0,3).map(branch => <Link key={branch.id} className="secondary-link" href={"/queue-display/" + branch.id}>{branch.code} {tr(locale, "Queue Display", "شاشة الطابور")}</Link>)}
        <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}</Link>
      </div>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Portal Accounts", "حسابات البوابة")}</h2><strong>{portalAccounts.length}</strong><p className="muted">{tr(locale, "Patient, doctor and corporate identities.", "هويات المرضى والأطباء والشركات.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Pending Appointments", "المواعيد المعلقة")}</h2><strong>{pendingAppointments}</strong><p className="muted">{tr(locale, "Requested, confirmed or checked in.", "مطلوبة أو مؤكدة أو تم تسجيل الحضور لها.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Active Home Collection", "السحب المنزلي النشط")}</h2><strong>{activeHome}</strong><p className="muted">{tr(locale, "Visits not yet delivered or cancelled.", "زيارات لم تُسلّم للمختبر ولم تُلغَ بعد.")}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Queue Waiting/Serving", "المنتظرون/قيد الخدمة")}</h2><strong>{activeQueue}</strong><p className="muted">{tr(locale, "Reception and phlebotomy queue today.", "طابور الاستقبال وسحب الدم لليوم.")}</p></article>
    </section>

    <DigitalServicesConsole
      locale={locale}
      permissions={{
        portalAccounts: permissions.has("portal_accounts.manage"),
        appointments: permissions.has("appointments.manage"),
        homeCollection: permissions.has("home_collection.manage"),
        queue: permissions.has("queue.manage"),
      }}
      branches={branches}
      patients={patients.map(item => ({ id: item.id, label: item.patientNumber + " — " + patientName(item) }))}
      referrers={referrers.map(item => ({ id: item.id, label: item.code + " — " + namedEntity(item) }))}
      clients={clients.map(item => ({ id: item.id, label: item.code + " — " + namedEntity(item) }))}
      users={users.map(item => ({ id: item.id, label: userName(item) + " (" + item.username + ")" }))}
      portalAccounts={portalAccounts.map(item => ({
        id: item.id,
        type: item.type,
        subject: item.patient ? patientName(item.patient) : item.referrer ? namedEntity(item.referrer) : item.client ? namedEntity(item.client) : "—",
        contact: item.email || item.phone || "—",
        status: item.status,
        mustChangePassword: item.mustChangePassword,
      }))}
      corporateAccess={corporateAccess.map(item => ({
        id: item.id,
        client: item.client.code + " — " + namedEntity(item.client),
        patient: item.patient.patientNumber + " — " + patientName(item.patient),
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
        patient: patientName(item.patient),
        branch: namedEntity(item.branch),
        mode: item.mode,
        scheduledStart: item.scheduledStart.toISOString(),
        status: item.status,
      }))}
      homeCollections={homeCollections.map(item => ({
        id: item.id,
        appointmentNumber: item.appointment.appointmentNumber,
        patient: patientName(item.appointment.patient),
        branch: namedEntity(item.branch),
        collector: item.assignedCollector ? userName(item.assignedCollector) : null,
        status: item.status,
        scheduledStart: item.appointment.scheduledStart.toISOString(),
      }))}
      queueTickets={queueTickets.map(item => ({
        id: item.id,
        ticketNumber: item.ticketNumber,
        patient: patientName(item.patient),
        branch: namedEntity(item.branch),
        stage: item.stage,
        status: item.status,
        priority: item.priority,
        counterLabel: item.counterLabel,
        issuedAt: item.issuedAt.toISOString(),
      }))}
    />
  </main>;
}
