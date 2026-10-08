import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, priorityLabel, statusLabel, tr } from "@/lib/ui-i18n";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.view");
  const { id } = await params;
  const locale = getUiLocale(session.user.preferredLocale);

  const order = await prisma.labOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      patient: true,
      orderingBranch: true,
      referrer: true,
      client: true,
      createdBy: true,
      packages: {
        include: {
          package: true,
          priceListPackageItem: { include: { priceList: true } },
          items: { include: { orderItem: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      items: {
        include: {
          test: true,
          performedBranch: true,
          priceListItem: { include: { priceList: true } },
          answers: { orderBy: { recordedAt: "asc" } },
          results: { orderBy: { version: "desc" }, take: 1, include: { values: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      invoices: {
        include: { lines: true, allocations: { include: { payment: true } } },
        orderBy: { issuedAt: "desc" },
      },
      statusHistory: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
      specimens: {
        include: {
          specimenType: true,
          container: true,
          currentBranch: true,
          orderItems: { include: { orderItem: true } },
          events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });

  if (!order || !canAccessBranch(session, order.orderingBranchId)) notFound();
  const packageByOrderItemId = new Map(order.packages.flatMap(pkg =>
    pkg.items.map(link => [link.orderItemId, pkg] as const)
  ));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Order Record", "سجل الطلب")}</p>
        <h1>{order.accessionNumber}</h1>
        <p className="muted">{order.patient.patientNumber} · {locale === "ar" ? order.patient.fullNameAr || order.patient.fullNameEn : order.patient.fullNameEn} · {locale === "ar" ? order.orderingBranch.nameAr || order.orderingBranch.nameEn : order.orderingBranch.nameEn}</p>
      </div>
      <Link className="secondary-link" href="/orders">{tr(locale, "Back to Orders", "العودة للطلبات")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Order Context", "بيانات الطلب")}</h2>
        <dl>
          <dt>{tr(locale, "Status", "الحالة")}</dt><dd>{statusLabel(locale, order.status)}</dd>
          <dt>{tr(locale, "Priority", "الأولوية")}</dt><dd>{priorityLabel(locale, order.priority)}</dd>
          <dt>{tr(locale, "Ordered", "تاريخ الطلب")}</dt><dd>{order.orderedAt.toISOString().replace("T"," ").slice(0,19)}</dd>
          <dt>{tr(locale, "Referrer", "المحيل")}</dt><dd>{order.referrer?.nameEn || "—"}</dd>
          <dt>{tr(locale, "Client", "العميل")}</dt><dd>{order.client?.nameEn || tr(locale, "Patient / walk-in", "مريض / حضور مباشر")}</dd>
          <dt>{tr(locale, "Fasting", "صائم")}</dt><dd>{order.fasting === null ? tr(locale, "Unknown", "غير معروف") : order.fasting ? tr(locale, "Yes", "نعم") : tr(locale, "No", "لا")}</dd>
          <dt>{tr(locale, "Pregnancy status", "حالة الحمل")}</dt><dd>{
            order.pregnancyStatus === "PREGNANT" ? tr(locale, "Pregnant", "حامل") :
            order.pregnancyStatus === "NOT_PREGNANT" ? tr(locale, "Not pregnant", "غير حامل") :
            tr(locale, "Unknown / not stated", "غير معروف / غير مذكور")
          }</dd>
          <dt>{tr(locale, "Gestational age", "عمر الحمل")}</dt><dd>{order.gestationalAgeWeeks !== null ? order.gestationalAgeWeeks.toString() + " " + tr(locale, "weeks", "أسبوع") : "—"}</dd>
          <dt>{tr(locale, "Reference population", "المجموعة المرجعية")}</dt><dd>{order.referencePopulationCode || "—"}</dd>
          <dt>{tr(locale, "Diagnosis", "التشخيص")}</dt><dd>{order.diagnosis || "—"}</dd>
          <dt>{tr(locale, "Created by", "أنشئ بواسطة")}</dt><dd>{order.createdBy.displayNameEn}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Clinical Notes", "الملاحظات السريرية")}</h2>
        <p>{order.clinicalNotes || "—"}</p>
        <h3>{tr(locale, "Pregnancy information", "معلومات الحمل")}</h3>
        <p>{order.pregnancyInfo || "—"}</p>
      </article>
    </section>

    {order.packages.length > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Commercial Packages", "الباقات التجارية")}</h2><span>{tr(locale, "Historical package and price snapshots", "لقطات تاريخية للباقة والسعر")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Package", "الباقة")}</th><th>{tr(locale, "Member tests", "الفحوصات")}</th><th>{tr(locale, "Price list", "قائمة الأسعار")}</th><th>{tr(locale, "Price snapshot", "السعر المحفوظ")}</th></tr></thead>
        <tbody>{order.packages.map(pkg => <tr key={pkg.id}>
          <td><strong>{pkg.packageCodeSnapshot}</strong><br/><small>{pkg.packageNameEnSnapshot}</small></td>
          <td>{pkg.items.map(link => link.orderItem.testCodeSnapshot).join(", ")}</td>
          <td>{pkg.priceListPackageItem?.priceList.code || tr(locale, "Historical / unavailable", "تاريخي / غير متاح")}</td>
          <td><strong>{pkg.finalPriceSnapshot.toString()} {pkg.currency}</strong></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr(locale, "Ordered Tests", "الفحوصات المطلوبة")}</h2><span>{order.items.length} {tr(locale, "item(s)", "فحص")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Code snapshot", "الرمز المحفوظ")}</th><th>{tr(locale, "Name snapshot", "الاسم المحفوظ")}</th><th>{tr(locale, "Unit snapshot", "الوحدة المحفوظة")}</th><th>{tr(locale, "Performed branch", "فرع التنفيذ")}</th><th>{tr(locale, "Price source", "مصدر السعر")}</th><th>{tr(locale, "Price snapshot", "السعر المحفوظ")}</th><th>{tr(locale, "Result", "النتيجة")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{order.items.map(item => {
            const packageSnapshot = packageByOrderItemId.get(item.id);
            return <tr key={item.id}>
            <td><strong>{item.testCodeSnapshot}</strong></td>
            <td>{locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot}</td>
            <td>{item.unitSnapshot || "—"}</td>
            <td>{item.performedBranch?.nameEn || "—"}</td>
            <td>{packageSnapshot ? tr(locale, "Package", "باقة") + " " + packageSnapshot.packageCodeSnapshot : item.priceListItem?.priceList.code || "—"}</td>
            <td>{packageSnapshot ? tr(locale, "Included in package", "مشمول ضمن الباقة") : item.finalPriceSnapshot.toString() + " " + item.currency}</td>
            <td>{item.results[0] ? <Link className="table-link" href={`/worklists/${item.id}`}>{statusLabel(locale, item.results[0].status)}{item.results[0].values.some(value => value.isCritical) ? " · " + tr(locale, "CRITICAL", "حرج") : ""}</Link> : "—"}</td>
            <td>{statusLabel(locale, item.status)}</td>
          </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    {order.items.some(item => item.answers.length > 0) && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Ask-at-Order Answers", "إجابات أسئلة الطلب")}</h2><span>{tr(locale, "Historical question snapshots", "لقطات تاريخية للأسئلة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Question", "السؤال")}</th><th>{tr(locale, "Answer", "الإجابة")}</th><th>{tr(locale, "Recorded", "تم التسجيل")}</th></tr></thead>
        <tbody>{order.items.flatMap(item => item.answers.map(answer => {
          const selectedOption = locale === "ar"
            ? answer.selectedOptionTextArSnapshot || answer.selectedOptionTextEnSnapshot || answer.selectedOptionSnapshot
            : answer.selectedOptionTextEnSnapshot || answer.selectedOptionSnapshot;
          const dateTimeAnswer = answer.answerDateTimeLocalSnapshot
            ? answer.answerDateTimeLocalSnapshot.replace("T", " ") + (answer.answerTimeZoneSnapshot ? " · " + answer.answerTimeZoneSnapshot : "")
            : answer.answerDateTime?.toISOString().replace("T"," ").slice(0,19) || null;
          const displayAnswer = answer.answerText
            ?? answer.answerNumeric?.toString()
            ?? (answer.answerBoolean === null ? null : answer.answerBoolean ? tr(locale, "Yes", "نعم") : tr(locale, "No", "لا"))
            ?? answer.answerDate?.toISOString().slice(0,10)
            ?? dateTimeAnswer
            ?? selectedOption
            ?? "—";
          return <tr key={answer.id}>
            <td><strong>{item.testCodeSnapshot}</strong></td>
            <td>{answer.questionTextEnSnapshot}{answer.questionTextArSnapshot && <><br/><small dir="rtl">{answer.questionTextArSnapshot}</small></>}<br/><small>{answer.questionCodeSnapshot} · v{answer.questionVersionSnapshot}</small></td>
            <td><strong>{displayAnswer}</strong>{answer.selectedOptionCodeSnapshot ? <><br/><small>{answer.selectedOptionCodeSnapshot}</small></> : null}</td>
            <td>{answer.recordedAt.toISOString().replace("T"," ").slice(0,19)}</td>
          </tr>;
        }))}</tbody>
      </table></div>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Specimens", "العينات")}</h2><span>{order.specimens.length} {tr(locale, "planned / historical", "مخططة / تاريخية")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Barcode", "الباركود")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Container", "الحاوية")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th><th>{tr(locale, "Current branch", "الفرع الحالي")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{order.specimens.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No specimen plans.", "لا توجد عينات مخططة.")}</td></tr> : order.specimens.map(specimen => {
            const requirement = specimen.events
              .map(event => specimenRequirementSnapshotFromDetails(event.details))
              .find(Boolean) || null;
            const specimenName = requirement?.specimenTypeNameEn
              ? (locale === "ar" ? requirement.specimenTypeNameAr || requirement.specimenTypeNameEn : requirement.specimenTypeNameEn)
              : specimen.specimenType
                ? (locale === "ar" ? specimen.specimenType.nameAr || specimen.specimenType.nameEn : specimen.specimenType.nameEn)
                : tr(locale, "Not configured", "غير مهيأ");
            const containerName = requirement?.containerNameEn
              ? (locale === "ar" ? requirement.containerNameAr || requirement.containerNameEn : requirement.containerNameEn)
              : specimen.container
                ? (locale === "ar" ? specimen.container.nameAr || specimen.container.nameEn : specimen.container.nameEn)
                : "—";
            return <tr key={specimen.id}>
              <td><Link className="table-link" href={`/specimens?q=${encodeURIComponent(specimen.barcode)}`}><strong>{specimen.barcode}</strong></Link>{requirement ? <><br/><small>{tr(locale, "Order-time snapshot", "لقطة وقت الطلب")} · v{requirement.requirementEngineVersion}</small></> : <><br/><small>{tr(locale, "Historical snapshot missing", "اللقطة التاريخية غير موجودة")}</small></>}</td>
              <td>{specimenName}{requirement?.specimenTypeCode ? <><br/><small>{requirement.specimenTypeCode}</small></> : null}</td>
              <td>{containerName}{requirement?.containerCode ? <><br/><small>{requirement.containerCode}</small></> : null}</td>
              <td>{specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(", ")}{requirement?.requiredVolume ? <><br/><small>{tr(locale, "Required", "المطلوب")}: {requirement.requiredVolume} {requirement.requiredVolumeUnit || ""}</small></> : null}</td>
              <td>{specimen.currentBranch ? (locale === "ar" ? specimen.currentBranch.nameAr || specimen.currentBranch.nameEn : specimen.currentBranch.nameEn) : "—"}</td>
              <td>{statusLabel(locale, specimen.status)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>{tr(locale, "Invoices", "الفواتير")}</h2>
        {order.invoices.length === 0 ? <p className="muted">{tr(locale, "No invoices.", "لا توجد فواتير.")}</p> :
          <div className="summary-list">{order.invoices.map(invoice => <div key={invoice.id}>
            <span>{invoice.invoiceNumber} · {statusLabel(locale, invoice.status)}</span>
            <strong>{invoice.total.toString()} {invoice.currency} · {tr(locale, "Balance", "الرصيد")} {invoice.balanceAmount.toString()}</strong>
          </div>)}</div>}
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Status History", "سجل الحالات")}</h2>
        <div className="summary-list">{order.statusHistory.map(entry => <div key={entry.id}>
          <span>{entry.changedAt.toISOString().replace("T"," ").slice(0,19)} · {entry.changedBy.displayNameEn}</span>
          <strong>{entry.fromStatus ? statusLabel(locale, entry.fromStatus) : tr(locale, "NEW", "جديد")} → {statusLabel(locale, entry.toStatus)}</strong>
        </div>)}</div>
      </article>
    </section>
  </main>;
}
