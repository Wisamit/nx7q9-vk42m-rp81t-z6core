import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessDepartment, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyCaseEditor } from "@/components/microbiology-case-editor";
import { MicrobiologyFinalWorkflow } from "@/components/microbiology-final-workflow";
import { ValidationHoldPanel } from "@/components/validation-hold-panel";
import { getUiLocale, sexLabel, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function MicrobiologyCasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
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
      result: {
        include: {
          validationHoldEvents: {
            include: { reviewedBy: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
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

  if (!microbiologyCase || !canAccessDepartment(session, microbiologyCase.orderItem.test.departmentId)) notFound();

  const [organisms, antibiotics] = await Promise.all([
    prisma.organism.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.antibiotic.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const specimenReadyForProcessing = microbiologyCase.specimen.status === "IN_PROCESS"
    && microbiologyCase.specimen.currentBranchId === microbiologyCase.performingBranchId;
  const locked = ["FINAL","CANCELLED"].includes(microbiologyCase.status)
    || Boolean(microbiologyCase.result) || !specimenReadyForProcessing;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Microbiology Case", "حالة أحياء دقيقة")}</p>
        <h1>{microbiologyCase.orderItem.test.code} — {locale === "ar" ? microbiologyCase.orderItem.test.nameAr || microbiologyCase.orderItem.test.nameEn : microbiologyCase.orderItem.test.nameEn}</h1>
        <p className="muted">{microbiologyCase.orderItem.order.accessionNumber} · {microbiologyCase.orderItem.order.patient.patientNumber} · {locale === "ar" ? microbiologyCase.orderItem.order.patient.fullNameAr || microbiologyCase.orderItem.order.patient.fullNameEn : microbiologyCase.orderItem.order.patient.fullNameEn}</p>
      </div>
      <Link className="secondary-link" href="/microbiology">{tr(locale, "Back to Microbiology", "العودة للأحياء الدقيقة")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Patient & Order", "المريض والطلب")}</h2>
        <dl>
          <dt>{tr(locale, "Patient", "المريض")}</dt><dd>{locale === "ar" ? microbiologyCase.orderItem.order.patient.fullNameAr || microbiologyCase.orderItem.order.patient.fullNameEn : microbiologyCase.orderItem.order.patient.fullNameEn}</dd>
          <dt>{tr(locale, "Date of birth", "تاريخ الميلاد")}</dt><dd>{microbiologyCase.orderItem.order.patient.dateOfBirth?.toISOString().slice(0,10) || "—"}</dd>
          <dt>{tr(locale, "Sex at birth", "الجنس عند الولادة")}</dt><dd>{sexLabel(locale, microbiologyCase.orderItem.order.patient.sexAtBirth)}</dd>
          <dt>{tr(locale, "Accession", "رقم الطلب")}</dt><dd>{microbiologyCase.orderItem.order.accessionNumber}</dd>
          <dt>{tr(locale, "Ordering branch", "فرع الطلب")}</dt><dd>{microbiologyCase.orderItem.order.orderingBranch.nameEn}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Case & Specimen", "الحالة والعينة")}</h2>
        <dl>
          <dt>{tr(locale, "Case status", "حالة الحالة")}</dt><dd>{statusLabel(locale, microbiologyCase.status)}</dd>
          <dt>{tr(locale, "Culture status", "حالة الزرع")}</dt><dd>{statusLabel(locale, microbiologyCase.cultureStatus)}</dd>
          <dt>{tr(locale, "Performing branch", "فرع التنفيذ")}</dt><dd>{microbiologyCase.performingBranch.nameEn}</dd>
          <dt>{tr(locale, "Barcode", "الباركود")}</dt><dd><strong>{microbiologyCase.specimen.barcode}</strong></dd>
          <dt>{tr(locale, "Specimen", "العينة")}</dt><dd>{microbiologyCase.specimen.specimenType?.nameEn || "—"}</dd>
          <dt>{tr(locale, "Container", "الحاوية")}</dt><dd>{microbiologyCase.specimen.container?.nameEn || "—"}</dd>
        </dl>
      </article>
    </section>

    {!specimenReadyForProcessing && <section className="detail-card" role="alert">
      <strong>{tr(locale, "Specimen unavailable for microbiology processing", "العينة غير متاحة لمعالجة الأحياء الدقيقة")}</strong>
      <p className="muted">{tr(locale, "The specimen may be quarantined, rejected, transferred or outside the performing branch. The culture history remains visible, but new observations and susceptibility tests are blocked.", "قد تكون العينة محجورة أو مرفوضة أو منقولة أو خارج فرع التنفيذ. يبقى سجل الزرع ظاهراً، لكن تُمنع الملاحظات الجديدة واختبارات الحساسية.")}</p>
    </section>}

    {!locked && permissions.has("microbiology.enter") && <MicrobiologyCaseEditor
      locale={locale}
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
        <div className="table-toolbar"><h2>{tr(locale, "Culture Observations", "ملاحظات الزرع")}</h2><span>{microbiologyCase.observations.length}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Time", "الوقت")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Observation", "الملاحظة")}</th><th>{tr(locale, "Entered by", "أُدخل بواسطة")}</th></tr></thead>
          <tbody>{microbiologyCase.observations.length === 0 ? <tr><td colSpan={4} className="empty-state">{tr(locale, "No culture observations recorded.", "لا توجد ملاحظات زرع مسجلة.")}</td></tr> : microbiologyCase.observations.map(item => <tr key={item.id}>
            <td>{item.observedAt.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{item.observationType}</td>
            <td>{item.observationText}</td>
            <td>{item.enteredBy.displayNameEn}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="detail-card">
        <h2>{tr(locale, "Interpretive Comments", "التعليقات التفسيرية")}</h2>
        <dl>
          <dt>{tr(locale, "Preliminary", "أولي")}</dt><dd>{microbiologyCase.preliminaryComment || "—"}</dd>
          <dt>{tr(locale, "Final", "نهائي")}</dt><dd>{microbiologyCase.finalComment || tr(locale, "Not finalized", "غير نهائي")}</dd>
          <dt>{tr(locale, "Created by", "أنشئ بواسطة")}</dt><dd>{microbiologyCase.createdBy.displayNameEn}</dd>
          <dt>{tr(locale, "Finalized by", "تم الإنهاء بواسطة")}</dt><dd>{microbiologyCase.finalizedBy?.displayNameEn || "—"}</dd>
        </dl>
        <p className="muted">{tr(locale, "Final microbiology content is bridged into the normal versioned LaboratoryResult workflow before verification and release.", "يتم ربط المحتوى النهائي للأحياء الدقيقة بمسار LaboratoryResult ذي الإصدارات قبل التحقق والإصدار.")}</p>
      </article>
    </section>


    <MicrobiologyFinalWorkflow
      caseId={microbiologyCase.id}
      locale={locale}
      resultId={microbiologyCase.result?.id || null}
      resultStatus={microbiologyCase.result?.status || null}
      finalComment={microbiologyCase.finalComment || ""}
      canEnter={permissions.has("microbiology.enter")}
      specimenReadyForProcessing={specimenReadyForProcessing}
      canVerify={permissions.has("results.verify")}
      canRelease={permissions.has("results.release")}
      orderId={microbiologyCase.orderItem.order.id}
    />

    {microbiologyCase.result && <ValidationHoldPanel
      resultId={microbiologyCase.result.id}
      locale={locale}
      canReview={permissions.has("validation_holds.review")}
      events={microbiologyCase.result.validationHoldEvents.map(event => ({
        id: event.id,
        status: event.status,
        severity: event.severitySnapshot,
        reasonEn: event.reasonEnSnapshot,
        reasonAr: event.reasonArSnapshot,
        reviewedBy: event.reviewedBy?.displayNameEn || null,
        reviewedAt: event.reviewedAt?.toISOString() || null,
        reviewNote: event.reviewNote,
      }))}
    />}

    <section className="detail-section">
      <h2>{tr(locale, "Isolates & Susceptibility", "العزلات والحساسية")}</h2>
      {microbiologyCase.isolates.length === 0 ? <div className="detail-card"><p className="empty-state">{tr(locale, "No organisms isolated.", "لم يتم عزل كائنات دقيقة.")}</p></div> :
        microbiologyCase.isolates.map(isolate => <article className="detail-card detail-section" key={isolate.id}>
          <h3>{tr(locale, "Isolate", "العزلة")} #{isolate.sequenceNumber}: {isolate.organism.code} — {isolate.organism.nameEn}</h3>
          <p className="muted">{isolate.quantityText || tr(locale, "Quantity not specified", "الكمية غير محددة")}{isolate.colonyNotes ? " · " + isolate.colonyNotes : ""}</p>
          {isolate.susceptibilityTests.length === 0 ? <p className="empty-state">{tr(locale, "No susceptibility panel recorded.", "لا توجد لوحة حساسية مسجلة.")}</p> :
            isolate.susceptibilityTests.map(test => <div className="table-wrap" key={test.id}>
              <p><strong>{test.method || tr(locale, "Method not specified", "الطريقة غير محددة")}</strong> · {test.testedAt.toISOString().replace("T"," ").slice(0,19)} · {test.enteredBy.displayNameEn}</p>
              <table>
                <thead><tr><th>{tr(locale, "Antibiotic", "المضاد الحيوي")}</th><th>S/I/R</th><th>MIC</th><th>{tr(locale, "Zone", "القطر")}</th><th>{tr(locale, "Breakpoint snapshot", "حد التفسير المحفوظ")}</th></tr></thead>
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
