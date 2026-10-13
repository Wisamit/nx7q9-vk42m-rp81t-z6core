import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { OrderCreateModal } from "@/components/order-create-modal";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, priorityLabel, statusLabel, tr } from "@/lib/ui-i18n";
import { effectiveDiscountLimit } from "@/lib/discount-policy";
import { normalizeOrderQuestionOptions } from "@/lib/order-questions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: {
  searchParams: Promise<{ doctorRequisitionId?: string }>;
}) {
  const session = await requirePermission("orders.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const questionAsOf = new Date();

  const accessibleBranchIds = session.user.branchScopes.map(scope => scope.branchId);
  const discountLimitPercent = effectiveDiscountLimit({
    userOverride: session.user.discountLimitPercent,
    roleLimits: session.user.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .map(assignment => assignment.role.discountLimitPercent),
  });

  const [patients, tests, packages, clients, referrers, sources, branches, orders] = await Promise.all([
    prisma.patient.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, patientNumber: true, fullNameEn: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        orderQuestions: {
          where: {
            status: "ACTIVE",
            effectiveFrom: { lte: questionAsOf },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: questionAsOf } }],
          },
          select: {
            id: true,
            code: true,
            questionEn: true,
            questionAr: true,
            responseType: true,
            required: true,
            options: true,
            displayOrder: true,
          },
          orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        },
      },
      orderBy: { nameEn: "asc" },
    }),
    prisma.commercialPackage.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        items: {
          select: { testId: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { nameEn: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.referrer.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, clientId: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.orderSource.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, category: true, nameEn: true },
      orderBy: [{ category: "asc" }, { nameEn: "asc" }],
    }),
    prisma.branch.findMany({
      where: {
        id: { in: accessibleBranchIds },
        organizationId: session.user.organizationId,
        status: "ACTIVE",
      },
      select: { id: true, code: true, nameEn: true, timezone: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labOrder.findMany({
      where: { organizationId: session.user.organizationId, orderingBranchId: { in: accessibleBranchIds } },
      include: {
        patient: true,
        orderingBranch: true,
        client: true,
        referrer: true,
        source: true,
        items: true,
        invoices: { orderBy: { issuedAt: "desc" }, take: 1 },
      },
      orderBy: { orderedAt: "desc" },
      take: 100,
    }),
  ]);

  const requestedRequisitionId = (await searchParams).doctorRequisitionId;
  const linkedRequisition = requestedRequisitionId
    ? await prisma.doctorRequisition.findFirst({
        where:{id:requestedRequisitionId,organizationId:session.user.organizationId,
          branchId:{in:branches.map(x=>x.id)},status:"SUBMITTED"},
        include:{items:{select:{testId:true}},
          patient:{select:{id:true,patientNumber:true,fullNameEn:true,phone:true,status:true}}},
      }) : null;
  const eligibleRequisition = linkedRequisition?.patient.status==="ACTIVE" &&
    linkedRequisition.items.length>0 &&
    linkedRequisition.items.every(item=>tests.some(test=>test.id===item.testId))
    ? linkedRequisition:null;
  const displayedPatients = eligibleRequisition &&
    !patients.some(patient=>patient.id===eligibleRequisition.patientId)
    ? [...patients,eligibleRequisition.patient] : patients;

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayOrders = orders.filter(order => order.orderedAt >= todayStart);
  const urgentOrders = orders.filter(order => ["URGENT","STAT"].includes(order.priority) && order.status !== "COMPLETED" && order.status !== "CANCELLED");
  const openOrders = orders.filter(order => !["COMPLETED","CANCELLED"].includes(order.status));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Order Entry", "إدخال الطلبات")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="orders" size={25} />{tr(locale, "Orders", "الطلبات")}</h1>
        <p className="muted">{tr(locale, "Register laboratory orders with branch, patient, referral source and effective-dated price snapshots.", "تسجيل طلبات المختبر مع الفرع والمريض ومصدر الإحالة وأسعار محفوظة بتاريخها الفعلي.")}</p>
      </div>
      <div className="header-actions">
        <OrderCreateModal
          patients={displayedPatients}
          initialDoctorRequisition={eligibleRequisition ? {
            id:eligibleRequisition.id,patientId:eligibleRequisition.patientId,
            branchId:eligibleRequisition.branchId,referrerId:eligibleRequisition.referrerId,
            priority:eligibleRequisition.priority,diagnosis:eligibleRequisition.diagnosis,
            clinicalNotes:eligibleRequisition.clinicalNotes,
            testIds:eligibleRequisition.items.map(x=>x.testId),
          } : null}
          tests={tests.map(test => ({
            ...test,
            orderQuestions: test.orderQuestions.map(question => ({
              ...question,
              options: normalizeOrderQuestionOptions(question.options),
            })),
          }))}
          packages={packages.map(pkg => ({ id: pkg.id, code: pkg.code, nameEn: pkg.nameEn, testIds: pkg.items.map(item => item.testId) }))}
          clients={clients}
          referrers={referrers}
          sources={sources}
          branches={branches}
          activeBranchId={session.activeBranchId}
          discountLimitPercent={discountLimitPercent}
          locale={locale}
        />
        <Link className="secondary-link" href="/orders/delivery-queue">{tr(locale,
          "Promised delivery follow-up","متابعة مواعيد التسليم")}</Link>
        <Link className="secondary-link" href="/doctor-requisitions">
          {tr(locale,"Physician Requisitions","إحالات الأطباء")}</Link>
        <Link className="secondary-link" href="/pricing"><SystemIcon name="pricing" size={15} />{tr(locale, "Pricing", "الأسعار")}</Link>
        <Link className="secondary-link" href="/billing"><SystemIcon name="billing" size={15} />{tr(locale, "Billing", "الفوترة")}</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Today", "اليوم")}</span><strong>{todayOrders.length}</strong><small>{tr(locale, "orders registered", "طلبات مسجلة")}</small></article>
      <article><span>{tr(locale, "Open", "مفتوحة")}</span><strong>{openOrders.length}</strong><small>{tr(locale, "awaiting completion", "بانتظار الإكمال")}</small></article>
      <article className={urgentOrders.length ? "summary-attention" : ""}><span>{tr(locale, "Urgent / STAT", "عاجل / فوري")}</span><strong>{urgentOrders.length}</strong><small>{tr(locale, "active priority orders", "طلبات أولوية نشطة")}</small></article>
      <article><span>{tr(locale, "Sources", "المصادر")}</span><strong>{sources.length}</strong><small>{tr(locale, "active acquisition sources", "مصادر إدخال نشطة")}</small></article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Recent Orders", "أحدث الطلبات")}</h2><span>{orders.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Source", "المصدر")}</th><th>{tr(locale, "Priority", "الأولوية")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th><th>{tr(locale, "Client / Referrer", "العميل / المحيل")}</th><th>{tr(locale, "Invoice", "الفاتورة")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>
            {orders.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No orders registered yet.", "لا توجد طلبات مسجلة بعد.")}</td></tr> :
              orders.map(order => {
                const invoice = order.invoices[0];
                return <tr key={order.id}>
                  <td><Link className="table-link" href={`/orders/${order.id}`}><strong>{order.accessionNumber}</strong></Link><br/><small>{order.orderedAt.toISOString().slice(0,16).replace("T"," ")}</small></td>
                  <td>{order.patient.patientNumber}<br/><small>{order.patient.fullNameEn}</small></td>
                  <td>{order.orderingBranch.code}</td>
                  <td>{order.source?.nameEn || tr(locale, "Legacy / unspecified", "قديم / غير محدد")}</td>
                  <td><span className={"status-badge priority-" + order.priority.toLowerCase()}>{priorityLabel(locale, order.priority)}</span></td>
                  <td>{order.items.length}</td>
                  <td>{order.client?.nameEn || order.referrer?.nameEn || tr(locale, "Patient / walk-in", "مريض / زيارة مباشرة")}</td>
                  <td>{invoice ? <>{invoice.invoiceNumber}<br/><small>{invoice.total.toString()} {invoice.currency}</small></> : "—"}</td>
                  <td><span className={"status-badge status-" + order.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, order.status)}</span></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
