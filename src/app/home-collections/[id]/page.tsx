import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HomeCollectionWorkstation } from "@/components/home-collection-workstation";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function HomeCollectionDetails({
  params,
}: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const canManage = permissions.has("home_collection.manage");
  const canView = canManage || permissions.has("home_collection.view") ||
    permissions.has("specimens.collect") || permissions.has("specimens.receive");
  if (!canView) redirect("/dashboard?forbidden=1");
  const { id } = await params;
  const branchIds = session.user.branchScopes.filter(b =>
    b.branch.status === "ACTIVE" &&
    b.branch.organizationId === session.user.organizationId).map(b => b.branchId);
  const visit = await prisma.homeCollectionVisit.findFirst({
    where: { id, branchId: { in: branchIds },
      appointment: { organizationId: session.user.organizationId, mode: "HOME_COLLECTION" } },
    include: {
      branch: true, assignedCollector: true, appointment: { include: { patient: true } },
      order: {
        include: {
          items: { select: { testCodeSnapshot: true, testNameEnSnapshot: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true,
            currency: true, total: true, paidAmount: true, balanceAmount: true } },
          specimens: {
            include: {
              collectionAttempts: { where: { homeCollectionVisitId: id },
                select: { homeCollectionVisitId: true, outcome: true,
                  collectorUserId: true, collectionLocationType: true } },
              receptionAssessments: { select: { branchId: true } },
            },
            orderBy: { sequenceNumber: "asc" },
          },
        },
      },
    },
  });
  if (!visit) notFound();
  const isAssigned = visit.assignedCollectorUserId === session.user.id;
  if (!canManage && !permissions.has("home_collection.view") && !isAssigned &&
    !(permissions.has("specimens.receive") && branchIds.includes(visit.branchId)))
    redirect("/dashboard?forbidden=1");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const canCollect = permissions.has("specimens.collect") && isAssigned;
  const canReceive = permissions.has("specimens.receive");
  const canLink = canManage && permissions.has("orders.view");
  const [collectors, availableOrders] = await Promise.all([
    canManage ? prisma.user.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE",
        branchScopes: { some: { branchId: visit.branchId,
          branch: { status: "ACTIVE" } } } },
      select: { id: true, username: true, displayNameEn: true, displayNameAr: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      take: 200, orderBy: { displayNameEn: "asc" },
    }) : Promise.resolve([]),
    canLink && !visit.orderId ? prisma.labOrder.findMany({
      where: { organizationId: session.user.organizationId,
        orderingBranchId: visit.branchId, patientId: visit.appointment.patientId,
        status: "REGISTERED",
        homeCollectionVisit: null,
        specimens: { some: {}, every: { status: "PLANNED" } }, items: { some: {} } },
      select: { id: true, accessionNumber: true, orderedAt: true,
        _count: { select: { specimens: true, invoices: true } } },
      orderBy: { orderedAt: "desc" }, take: 100,
    }) : Promise.resolve([]),
  ]);
  const patient = visit.appointment.patient;
  const name = locale === "ar" ? patient.fullNameAr || patient.fullNameEn : patient.fullNameEn;
  const specimens = visit.order?.specimens.map(s => ({
    id: s.id, barcode: s.barcode, status: s.status,
    type: s.parentRelationType || "PRIMARY",
    collectedHere: s.collectionAttempts.some(a =>
      a.outcome === "SUCCESS" && a.homeCollectionVisitId === id &&
      a.collectorUserId === visit.assignedCollectorUserId &&
      a.collectionLocationType === "HOME"),
    receivedHere: s.receptionAssessments.some(a => a.branchId === visit.branchId),
  })) || [];
  return <main className="page-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Home Collection Operations", "عمليات السحب المنزلي")}</p>
        <h1>{visit.appointment.appointmentNumber}</h1>
        <p className="muted">{name} · {patient.patientNumber} · {visit.branch.code} ·
          {" "}{<SystemDateText value={visit.appointment.scheduledStart.toISOString()} timeZone={visit.branch.timezone} />}</p>
        <p>{tr(locale,"Address","العنوان")}: {visit.appointment.addressSnapshot || "—"}</p>
        <p>{tr(locale,"Collector","المُجمّع")}: {visit.assignedCollector ?
          (locale === "ar" ? visit.assignedCollector.displayNameAr ||
          visit.assignedCollector.displayNameEn : visit.assignedCollector.displayNameEn) :
          tr(locale,"Not assigned","غير معيّن")}</p>
      </div>
      <Link className="secondary-link" href="/home-collections">
        {tr(locale, "Collection dispatch board", "لوحة زيارات السحب")}
      </Link>
    </header>
    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale,"Requested clinical services","الخدمات السريرية المطلوبة")}</h2>
        {visit.order ? <>
          <strong>{visit.order.accessionNumber}</strong>
          <p>{visit.order.items.map(i => i.testCodeSnapshot + " — " +
            i.testNameEnSnapshot).join(", ") || "—"}</p>
        </> : <p className="form-warning">{tr(locale,
          "No clinical LIS accession linked. Linking is required before visiting or collecting.",
          "لم يتم ربط طلب مخبري سريري. يجب ربطه قبل الزيارة أو جمع العينات.")}</p>}
      </article>
      <article className="detail-card">
        <h2>{tr(locale,"Collection protocol","بروتوكول الجمع")}</h2>
        <p>{tr(locale,"Verify patient with two identifiers; scan each barcode and record a HOME attempt. The laboratory must separately accept receipt with its own user and assessment.",
          "تحقق من المريض بمعرفين، وامسح باركود كل عينة وسجّل السحب المنزلي. الاستلام بالمختبر إجراء مستقل بتوثيق المستخدم والتقييم.")}</p>
        <p className="muted">{tr(locale,
          "Invoices are displayed in original currency; outstanding balances remain outstanding.",
          "تُعرض الفواتير بعملاتها الأصلية وتظل المبالغ المستحقة غير مسددة حتى يُسجل الدفع.")}</p>
      </article>
    </section>
    <HomeCollectionWorkstation
      visitId={visit.id} status={visit.status} orderId={visit.orderId}
      collectorUserId={visit.assignedCollectorUserId} accession={visit.order?.accessionNumber || null}
      locale={locale} isManager={canManage} canAdvance={canManage || canCollect}
      canCollect={canCollect} canReceive={canReceive}
      collectors={collectors.filter(user => user.roles.some(a => a.role.status === "ACTIVE" &&
        a.role.permissions.some(p => p.permission.code === "specimens.collect")))
        .map(user => ({ id: user.id, label: locale === "ar" ?
          user.displayNameAr || user.displayNameEn : user.displayNameEn }))}
      availableOrders={availableOrders.map(order => ({
        id: order.id, label: `${order.accessionNumber} — ${order._count.specimens} specimens / ${order._count.invoices} invoices`,
      }))}
      specimens={specimens}
      invoices={visit.order?.invoices.map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, currency: i.currency,
        total: i.total.toString(), paid: i.paidAmount.toString(), balance: i.balanceAmount.toString(),
      })) || []}
    />
  </main>;
}
