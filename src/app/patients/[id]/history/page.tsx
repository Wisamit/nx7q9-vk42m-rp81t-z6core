import Link from "next/link";
import { notFound } from "next/navigation";
import {
  authorizedDepartmentIds,
  permissionSet,
  requirePermission,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildPatientTrendSeries,
  latestClinicalResultIds,
  patientIdentityGroupIds,
  type TrendPointInput,
} from "@/lib/patient-history";
import { PatientResultTrends } from "@/components/patient-result-trends";
import { PatientHistoryPrintButton } from "@/components/patient-history-print-button";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PatientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.view");
  const { id } = await params;
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const canViewOrders = permissions.has("orders.view");
  const canViewReports = permissions.has("reports.view");
  const canViewBilling = permissions.has("billing.view");
  const canViewAttachments = permissions.has("attachments.view");
  const branchIds = session.user.branchScopes
    .filter(scope => scope.branch.status === "ACTIVE")
    .map(scope => scope.branchId);
  const departmentIds = authorizedDepartmentIds(session);

  const requestedPatient = await prisma.patient.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, mergedIntoPatientId: true },
  });
  if (!requestedPatient) notFound();

  const canonicalId = requestedPatient.mergedIntoPatientId || requestedPatient.id;
  const canonical = await prisma.patient.findFirst({
    where: { id: canonicalId, organizationId: session.user.organizationId },
    include: {
      mergedFrom: {
        select: {
          id: true,
          patientNumber: true,
          fullNameEn: true,
          fullNameAr: true,
          mergedAt: true,
        },
        orderBy: { mergedAt: "asc" },
      },
    },
  });
  if (!canonical) notFound();

  const patientIds = patientIdentityGroupIds(canonical.id, canonical.mergedFrom.map(item => item.id));
  const itemDepartmentFilter = departmentIds.length > 0
    ? { test: { departmentId: { in: departmentIds } } }
    : {};

  const orderScope = {
    organizationId: session.user.organizationId,
    patientId: { in: patientIds },
    orderingBranchId: { in: branchIds },
    ...(departmentIds.length > 0 ? { items: { some: itemDepartmentFilter } } : {}),
  };

  const orders = canViewOrders
    ? await prisma.labOrder.findMany({
        where: orderScope,
        include: {
          orderingBranch: { select: { id: true, nameEn: true, nameAr: true } },
          items: {
            where: itemDepartmentFilter,
            select: {
              id: true,
              testCodeSnapshot: true,
              testNameEnSnapshot: true,
              testNameArSnapshot: true,
              status: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { orderedAt: "desc" },
      })
    : [];

  const resultCandidates = canViewReports
    ? await prisma.laboratoryResult.findMany({
        where: {
          organizationId: session.user.organizationId,
          status: { in: ["RELEASED", "AMENDED"] },
          performingBranchId: { in: branchIds },
          orderItem: {
            order: {
              organizationId: session.user.organizationId,
              patientId: { in: patientIds },
            },
            ...itemDepartmentFilter,
          },
        },
        include: {
          orderItem: {
            select: {
              id: true,
              testId: true,
              testCodeSnapshot: true,
              testNameEnSnapshot: true,
              testNameArSnapshot: true,
              order: {
                select: {
                  id: true,
                  accessionNumber: true,
                  orderedAt: true,
                  orderingBranchId: true,
                  orderingBranch: { select: { nameEn: true, nameAr: true } },
                },
              },
            },
          },
          values: {
            where: { reportVisibleSnapshot: { not: false } },
            orderBy: [
              { reportSectionOrderSnapshot: "asc" },
              { reportDisplayOrderSnapshot: "asc" },
              { componentCodeSnapshot: "asc" },
            ],
          },
        },
        orderBy: [{ orderItemId: "asc" }, { version: "desc" }],
      })
    : [];

  const selectedResultKeys = latestClinicalResultIds(resultCandidates);
  const clinicalResults = resultCandidates
    .filter(result => selectedResultKeys.has(result.orderItemId + ":" + result.version))
    .sort((a, b) => {
      const aAt = a.releasedAt || a.enteredAt;
      const bAt = b.releasedAt || b.enteredAt;
      return bAt.getTime() - aAt.getTime();
    });

  const trendInputs: TrendPointInput[] = clinicalResults.flatMap(result => {
    const observedAt = (result.releasedAt || result.enteredAt).toISOString();
    return result.values.map(value => ({
      testId: result.orderItem.testId,
      testCode: result.orderItem.testCodeSnapshot,
      testNameEn: result.orderItem.testNameEnSnapshot,
      testNameAr: result.orderItem.testNameArSnapshot,
      componentId: value.componentId,
      componentCode: value.componentCodeSnapshot,
      componentNameEn: value.reportNameEnSnapshot || value.componentNameEnSnapshot,
      componentNameAr: value.reportNameArSnapshot || value.componentNameArSnapshot,
      unit: value.unitSnapshot,
      valueNumeric: value.valueNumeric?.toString() || null,
      displayValue: value.displayValue,
      flag: value.flag,
      observedAt,
      accessionNumber: result.orderItem.order.accessionNumber,
      orderId: result.orderItem.order.id,
      resultVersion: result.version,
    }));
  });
  const trendSeries = buildPatientTrendSeries(trendInputs);

  const reportVersions = canViewReports
    ? await prisma.diagnosticReportVersion.findMany({
        where: {
          report: {
            organizationId: session.user.organizationId,
            order: {
              patientId: { in: patientIds },
              orderingBranchId: { in: branchIds },
            },
          },
        },
        include: {
          report: {
            select: {
              order: {
                select: {
                  id: true,
                  accessionNumber: true,
                  orderedAt: true,
                },
              },
            },
          },
          branch: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { issuedAt: "desc" },
      })
    : [];

  const invoices = canViewBilling
    ? await prisma.invoice.findMany({
        where: {
          organizationId: session.user.organizationId,
          branchId: { in: branchIds },
          order: {
            patientId: { in: patientIds },
            orderingBranchId: { in: branchIds },
          },
        },
        include: {
          order: { select: { id: true, accessionNumber: true } },
          allocations: {
            include: {
              payment: {
                select: {
                  id: true,
                  amount: true,
                  refundedAmount: true,
                  currency: true,
                  method: true,
                  status: true,
                  reference: true,
                  receivedAt: true,
                },
              },
            },
          },
          creditNotes: {
            select: { id: true, creditNoteNumber: true, amount: true, status: true, issuedAt: true },
          },
          refunds: {
            select: { id: true, refundNumber: true, amount: true, status: true, processedAt: true },
          },
        },
        orderBy: { issuedAt: "desc" },
      })
    : [];

  const paymentRows = new Map<string, {
    id: string;
    amount: string;
    refundedAmount: string;
    allocatedAmount: string;
    currency: string;
    method: string;
    status: string;
    reference: string | null;
    receivedAt: Date;
    invoiceNumber: string;
  }>();
  for (const invoice of invoices) {
    for (const allocation of invoice.allocations) {
      const payment = allocation.payment;
      const key = payment.id + ":" + invoice.id;
      paymentRows.set(key, {
        id: payment.id,
        amount: payment.amount.toString(),
        refundedAmount: payment.refundedAmount.toString(),
        allocatedAmount: allocation.amount.toString(),
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
        reference: payment.reference,
        receivedAt: payment.receivedAt,
        invoiceNumber: invoice.invoiceNumber,
      });
    }
  }
  const payments = [...paymentRows.values()].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const accessibleOrderIds = canViewOrders ? orders.map(order => order.id) : [];
  const accessibleResultIdsForAttachments = canViewReports
    ? clinicalResults
        .filter(result => branchIds.includes(result.performingBranchId))
        .map(result => result.id)
    : [];
  const attachments = canViewAttachments
    ? await prisma.attachment.findMany({
        where: {
          organizationId: session.user.organizationId,
          OR: [
            { targetType: "PATIENT", targetId: { in: patientIds } },
            ...(canViewOrders && accessibleOrderIds.length > 0
              ? [{ targetType: "ORDER" as const, targetId: { in: accessibleOrderIds }, branchId: { in: branchIds } }]
              : []),
            ...(canViewReports && accessibleResultIdsForAttachments.length > 0
              ? [{ targetType: "RESULT" as const, targetId: { in: accessibleResultIdsForAttachments }, branchId: { in: branchIds } }]
              : []),
          ],
        },
        select: {
          id: true,
          targetType: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const cumulativeRows = clinicalResults.flatMap(result => result.values.map(value => ({
    key: result.id + ":" + value.id,
    observedAt: result.releasedAt || result.enteredAt,
    accessionNumber: result.orderItem.order.accessionNumber,
    orderId: result.orderItem.order.id,
    testName: locale === "ar"
      ? result.orderItem.testNameArSnapshot || result.orderItem.testNameEnSnapshot
      : result.orderItem.testNameEnSnapshot,
    componentName: locale === "ar"
      ? value.reportNameArSnapshot || value.componentNameArSnapshot || value.reportNameEnSnapshot || value.componentNameEnSnapshot
      : value.reportNameEnSnapshot || value.componentNameEnSnapshot,
    displayValue: value.displayValue,
    unit: value.unitSnapshot,
    flag: value.flag,
    isCritical: value.isCritical,
    referenceText: locale === "ar"
      ? value.referenceTextArSnapshot || value.referenceTextEnSnapshot
      : value.referenceTextEnSnapshot,
    referenceLow: value.referenceLowSnapshot?.toString() || null,
    referenceHigh: value.referenceHighSnapshot?.toString() || null,
    resultVersion: result.version,
    resultStatus: result.status,
  })));

  return <main className="catalog-shell patient-history-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Longitudinal Patient History", "السجل الطولي للمريض")}</p>
        <h1>{locale === "ar" ? canonical.fullNameAr || canonical.fullNameEn : canonical.fullNameEn}</h1>
        <p className="muted">
          {canonical.patientNumber} · {patientIds.length} {tr(locale, "linked identity record(s)", "سجل هوية مرتبط")}
        </p>
      </div>
      <div className="header-actions no-print">
        {canViewReports && <PatientHistoryPrintButton locale={locale} />}
        <Link className="secondary-link" href={"/patients/" + canonical.id}>{tr(locale, "Back to Patient", "العودة للمريض")}</Link>
      </div>
    </header>

    {patientIds.length > 1 && <section className="detail-card">
      <h2>{tr(locale, "Unified Identity", "الهوية الموحدة")}</h2>
      <p className="muted">{tr(
        locale,
        "This view combines the canonical patient with merged historical aliases without rewriting the original clinical or financial records.",
        "يجمع هذا العرض المريض الأساسي مع السجلات التاريخية المدمجة دون إعادة كتابة السجلات السريرية أو المالية الأصلية.",
      )}</p>
      <div className="summary-list">
        <div><span>{tr(locale, "Canonical", "الأساسي")}</span><strong>{canonical.patientNumber}</strong></div>
        {canonical.mergedFrom.map(alias => <div key={alias.id}>
          <span>{tr(locale, "Historical alias", "سجل تاريخي")} · {alias.patientNumber}</span>
          <strong>{alias.mergedAt ? alias.mergedAt.toISOString().slice(0, 10) : "—"}</strong>
        </div>)}
      </div>
    </section>}

    {canViewOrders && <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Order History", "سجل الطلبات")}</h2><span>{orders.length} {tr(locale, "order(s)", "طلب")}</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Date", "التاريخ")}</th>
          <th>{tr(locale, "Accession", "رقم الطلب")}</th>
          <th>{tr(locale, "Branch", "الفرع")}</th>
          <th>{tr(locale, "Tests", "الفحوصات")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th>
        </tr></thead>
        <tbody>{orders.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No accessible order history.", "لا يوجد سجل طلبات متاح ضمن صلاحياتك.")}</td></tr> : orders.map(order => <tr key={order.id}>
          <td>{order.orderedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td><Link className="table-link" href={"/orders/" + order.id}>{order.accessionNumber}</Link></td>
          <td>{locale === "ar" ? order.orderingBranch.nameAr || order.orderingBranch.nameEn : order.orderingBranch.nameEn}</td>
          <td>{order.items.map(item => locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot).join(", ") || "—"}</td>
          <td>{statusLabel(locale, order.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {canViewReports && <>
      <PatientResultTrends series={trendSeries} locale={locale} canViewOrders={canViewOrders} />

      <section className="table-card cumulative-history-table">
        <div className="table-toolbar">
          <div>
            <h2>{tr(locale, "Cumulative Results", "النتائج التراكمية")}</h2>
            <span>{tr(
              locale,
              "Uses immutable result snapshots and the latest released/amended result version per order item.",
              "يعتمد على لقطات النتائج التاريخية وآخر إصدار صادر/معدل لكل فحص في الطلب.",
            )}</span>
          </div>
          <span>{cumulativeRows.length}</span>
        </div>
        <div className="table-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Date", "التاريخ")}</th>
            <th>{tr(locale, "Accession", "رقم الطلب")}</th>
            <th>{tr(locale, "Test", "الفحص")}</th>
            <th>{tr(locale, "Component", "العنصر")}</th>
            <th>{tr(locale, "Result", "النتيجة")}</th>
            <th>{tr(locale, "Flag", "الإشارة")}</th>
            <th>{tr(locale, "Reference", "المرجع")}</th>
            <th>{tr(locale, "Version", "الإصدار")}</th>
          </tr></thead>
          <tbody>{cumulativeRows.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No released results are available.", "لا توجد نتائج صادرة متاحة.")}</td></tr> : cumulativeRows.map(row => {
            const reference = row.referenceText
              || (row.referenceLow !== null || row.referenceHigh !== null
                ? (row.referenceLow || "—") + " – " + (row.referenceHigh || "—")
                : "—");
            return <tr key={row.key}>
              <td>{row.observedAt.toISOString().replace("T"," ").slice(0,16)}</td>
              <td>{canViewOrders ? <Link className="table-link" href={"/orders/" + row.orderId}>{row.accessionNumber}</Link> : row.accessionNumber}</td>
              <td>{row.testName}</td>
              <td>{row.componentName}</td>
              <td><strong>{row.displayValue}</strong>{row.unit ? " " + row.unit : ""}</td>
              <td>{row.isCritical ? tr(locale, "CRITICAL", "حرج") : row.flag}</td>
              <td>{reference}</td>
              <td>v{row.resultVersion} · {statusLabel(locale, row.resultStatus)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>

      <section className="table-card">
        <div className="table-toolbar"><div><h2>{tr(locale, "Report Version History", "سجل إصدارات التقارير")}</h2><span>{reportVersions.length} {tr(locale, "version(s)", "إصدار")}</span></div></div>
        <div className="table-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Issued", "تاريخ الإصدار")}</th>
            <th>{tr(locale, "Accession", "رقم الطلب")}</th>
            <th>{tr(locale, "Report version", "إصدار التقرير")}</th>
            <th>{tr(locale, "Status", "الحالة")}</th>
            <th>{tr(locale, "Branch", "الفرع")}</th>
            <th>{tr(locale, "Amendment reason", "سبب التعديل")}</th>
          </tr></thead>
          <tbody>{reportVersions.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No report versions are available.", "لا توجد إصدارات تقارير متاحة.")}</td></tr> : reportVersions.map(version => <tr key={version.id}>
            <td>{version.issuedAt.toISOString().replace("T"," ").slice(0,16)}</td>
            <td><Link className="table-link" href={"/reports/" + version.report.order.id}>{version.report.order.accessionNumber}</Link></td>
            <td>v{version.version}</td>
            <td>{statusLabel(locale, version.status)}</td>
            <td>{locale === "ar" ? version.branch.nameAr || version.branch.nameEn : version.branch.nameEn}</td>
            <td>{version.amendmentReason || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>}

    {canViewBilling && <section className="table-card">
      <div className="table-toolbar"><div><h2>{tr(locale, "Financial History", "السجل المالي")}</h2><span>{invoices.length} {tr(locale, "invoice(s)", "فاتورة")}</span></div></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Issued", "الإصدار")}</th>
          <th>{tr(locale, "Invoice", "الفاتورة")}</th>
          <th>{tr(locale, "Accession", "رقم الطلب")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th>
          <th>{tr(locale, "Currency", "العملة")}</th>
          <th>{tr(locale, "Total", "الإجمالي")}</th>
          <th>{tr(locale, "Paid", "المدفوع")}</th>
          <th>{tr(locale, "Credited", "الإشعارات الدائنة")}</th>
          <th>{tr(locale, "Balance", "الرصيد")}</th>
        </tr></thead>
        <tbody>{invoices.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No accessible financial history.", "لا يوجد سجل مالي متاح ضمن صلاحياتك.")}</td></tr> : invoices.map(invoice => <tr key={invoice.id}>
          <td>{invoice.issuedAt.toISOString().slice(0,10)}</td>
          <td><strong>{invoice.invoiceNumber}</strong></td>
          <td>{invoice.order?.accessionNumber || "—"}</td>
          <td>{statusLabel(locale, invoice.status)}</td>
          <td>{invoice.currency}</td>
          <td>{invoice.total.toString()}</td>
          <td>{invoice.paidAmount.toString()}</td>
          <td>{invoice.creditedAmount.toString()}</td>
          <td>{invoice.balanceAmount.toString()}</td>
        </tr>)}</tbody>
      </table></div>

      <div className="table-toolbar history-subtable-toolbar"><div><h3>{tr(locale, "Payments", "المدفوعات")}</h3><span>{payments.length}</span></div></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Received", "تاريخ الاستلام")}</th>
          <th>{tr(locale, "Invoice", "الفاتورة")}</th>
          <th>{tr(locale, "Method", "الطريقة")}</th>
          <th>{tr(locale, "Currency", "العملة")}</th>
          <th>{tr(locale, "Payment", "الدفعة")}</th>
          <th>{tr(locale, "Allocated", "المخصص")}</th>
          <th>{tr(locale, "Refunded", "المسترد")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th>
        </tr></thead>
        <tbody>{payments.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No allocated payments.", "لا توجد مدفوعات مخصصة.")}</td></tr> : payments.map(payment => <tr key={payment.id + ":" + payment.invoiceNumber}>
          <td>{payment.receivedAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{payment.invoiceNumber}</td>
          <td>{payment.method}</td>
          <td>{payment.currency}</td>
          <td>{payment.amount}</td>
          <td>{payment.allocatedAmount}</td>
          <td>{payment.refundedAmount}</td>
          <td>{statusLabel(locale, payment.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {canViewAttachments && <section className="table-card no-print">
      <div className="table-toolbar"><div><h2>{tr(locale, "Attachment History", "سجل المرفقات")}</h2><span>{attachments.length} {tr(locale, "file(s)", "ملف")}</span></div></div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Uploaded", "تاريخ الرفع")}</th>
          <th>{tr(locale, "Context", "السياق")}</th>
          <th>{tr(locale, "File", "الملف")}</th>
          <th>{tr(locale, "Type", "النوع")}</th>
          <th>{tr(locale, "Size", "الحجم")}</th>
        </tr></thead>
        <tbody>{attachments.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No accessible attachments.", "لا توجد مرفقات متاحة ضمن صلاحياتك.")}</td></tr> : attachments.map(file => <tr key={file.id}>
          <td>{file.createdAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td>{file.targetType}</td>
          <td><a className="table-link" href={"/api/attachments/" + file.id}>{file.originalName}</a></td>
          <td>{file.contentType}</td>
          <td>{Math.ceil(file.sizeBytes / 1024)} {tr(locale, "KB", "ك.ب")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {!canViewOrders && !canViewReports && !canViewBilling && <section className="detail-card">
      <p className="muted">{tr(
        locale,
        "You can view the patient identity, but your role does not include order, report, or billing history permissions.",
        "يمكنك عرض هوية المريض، لكن دورك لا يتضمن صلاحيات سجل الطلبات أو التقارير أو الفوترة.",
      )}</p>
    </section>}
  </main>;
}
