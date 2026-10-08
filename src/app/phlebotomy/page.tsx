import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PhlebotomyCollectionCard } from "@/components/phlebotomy-collection-card";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, tr } from "@/lib/ui-i18n";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

export const dynamic = "force-dynamic";

export default async function PhlebotomyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; branch?: string; specimen?: string }>;
}) {
  const session = await requirePermission("specimens.collect");
  const locale = getUiLocale(session.user.preferredLocale);
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 120) || "";
  const requestedSpecimenId = params.specimen?.trim().slice(0, 36) || "";
  const branchIds = session.user.branchScopes
    .filter(scope => scope.branch.status === "ACTIVE")
    .map(scope => scope.branchId);

  const branches = await prisma.branch.findMany({
    where: {
      id: { in: branchIds },
      organizationId: session.user.organizationId,
      status: "ACTIVE",
    },
    select: { id: true, code: true, nameEn: true, nameAr: true },
    orderBy: { nameEn: "asc" },
  });
  const selectedBranchId = branchIds.includes(params.branch || "")
    ? params.branch!
    : session.activeBranchId && branchIds.includes(session.activeBranchId)
      ? session.activeBranchId
      : branchIds[0] || "";

  const specimens = await prisma.specimen.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: "PLANNED",
      currentBranchId: requestedSpecimenId ? { in: branchIds } : selectedBranchId ? selectedBranchId : { in: branchIds },
      ...(requestedSpecimenId ? { id: requestedSpecimenId } : {}),
      ...(q ? {
        OR: [
          { barcode: { contains: q } },
          { order: { accessionNumber: { contains: q } } },
          { order: { patient: { patientNumber: { contains: q } } } },
          { order: { patient: { fullNameEn: { contains: q } } } },
          { order: { patient: { fullNameAr: { contains: q } } } },
          { order: { patient: { phone: { contains: q } } } },
        ],
      } : {}),
    },
    include: {
      specimenType: true,
      container: true,
      parentSpecimen: { select: { barcode: true } },
      orderItems: {
        where: { status: "ACTIVE" },
        include: { orderItem: true },
      },
      order: {
        include: {
          patient: {
            include: {
              identifiers: {
                where: { status: "ACTIVE" },
                select: { id: true },
              },
            },
          },
        },
      },
      events: {
        where: { eventType: "CREATED" },
        orderBy: { occurredAt: "asc" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { sequenceNumber: "asc" }],
    take: 150,
  });

  const recentFailedAttempts = await prisma.specimenCollectionAttempt.findMany({
    where: {
      organizationId: session.user.organizationId,
      outcome: "FAILED",
      ...(selectedBranchId ? { branchId: selectedBranchId } : { branchId: { in: branchIds } }),
    },
    include: {
      specimen: {
        include: {
          order: { include: { patient: true } },
        },
      },
      replacementSpecimen: true,
    },
    orderBy: { attemptedAt: "desc" },
    take: 20,
  });

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) =>
    locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Pre-Analytical Workflow", "مرحلة ما قبل التحليل")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="specimen" size={25} />{tr(locale, "Phlebotomy & Collection", "سحب العينات")}</h1>
        <p className="muted">{tr(
          locale,
          "Verify the patient with two identifiers, review requested tubes and instructions, then record a successful or failed collection attempt.",
          "تحقق من المريض بمعرفين، راجع الأنابيب والتعليمات المطلوبة، ثم سجل محاولة سحب ناجحة أو فاشلة.",
        )}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens"><SystemIcon name="specimen" size={15} />{tr(locale, "Specimens", "العينات")}</Link>
        <Link className="secondary-link" href="/specimens/scan"><SystemIcon name="search" size={15} />{tr(locale, "Scan Station", "محطة المسح")}</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Ready", "جاهزة")}</span><strong>{specimens.length}</strong><small>{tr(locale, "planned specimens shown", "عينات مخططة معروضة")}</small></article>
      <article className={recentFailedAttempts.length ? "summary-attention" : ""}><span>{tr(locale, "Recent failed attempts", "محاولات فاشلة حديثة")}</span><strong>{recentFailedAttempts.length}</strong><small>{tr(locale, "latest 20 in this branch", "آخر 20 في هذا الفرع")}</small></article>
      <article><span>{tr(locale, "Verification", "التحقق")}</span><strong>2</strong><small>{tr(locale, "patient identifiers required", "معرفان للمريض مطلوبان")}</small></article>
      <article><span>{tr(locale, "Barcode reuse", "إعادة استخدام الباركود")}</span><strong>{tr(locale, "No", "لا")}</strong><small>{tr(locale, "failed draws create a new barcode", "فشل السحب ينشئ باركود جديد")}</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Collection Queue", "قائمة انتظار السحب")}</h2><span>{tr(locale, "Branch-scoped planned specimens", "عينات مخططة ضمن نطاق الفرع")}</span></div>
        <form className="inline-search" action="/phlebotomy" method="get">
          <input name="q" defaultValue={q} placeholder={tr(locale, "Barcode, accession, patient…", "باركود، طلب، مريض…")} autoFocus />
          <select name="branch" defaultValue={selectedBranchId}>
            {branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
          </select>
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Filter", "تصفية")}</button>
          {(q || requestedSpecimenId) && <Link className="secondary-link" href={selectedBranchId ? `/phlebotomy?branch=${selectedBranchId}` : "/phlebotomy"}>{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>
    </section>

    <div className="specimen-card-list">
      {specimens.length === 0 ? <section className="detail-card"><p className="empty-state">{tr(locale, "No planned specimens match this collection queue.", "لا توجد عينات مخططة مطابقة لقائمة السحب.")}</p></section> :
        specimens.map(specimen => {
          const requirement = specimen.events
            .map(event => specimenRequirementSnapshotFromDetails(event.details))
            .find(Boolean) || null;

          const secondaryOptions = [
            ...(specimen.order.patient.dateOfBirth ? [{ value: "DATE_OF_BIRTH", label: tr(locale, "Date of birth", "تاريخ الميلاد") }] : []),
            { value: "PATIENT_NUMBER", label: tr(locale, "Patient number", "رقم المريض") },
            ...(specimen.order.patient.normalizedPhone ? [{ value: "PHONE", label: tr(locale, "Phone number", "رقم الهاتف") }] : []),
            ...(specimen.order.patient.identifiers.length ? [{ value: "EXTERNAL_IDENTIFIER", label: tr(locale, "National ID / passport / external identifier", "الهوية / الجواز / معرف خارجي") }] : []),
          ];

          return <PhlebotomyCollectionCard
            key={specimen.id}
            locale={locale}
            activeBranchId={specimen.currentBranchId}
            branches={branches
              .filter(branch => branch.id === specimen.currentBranchId)
              .map(branch => ({ id: branch.id, code: branch.code, name: localizedName(branch) }))}
            specimen={{
              id: specimen.id,
              orderId: specimen.orderId,
              barcode: specimen.barcode,
              accessionNumber: specimen.order.accessionNumber,
              patientNumber: specimen.order.patient.patientNumber,
              patientName: patientName(specimen.order.patient),
              specimenName: requirement?.specimenTypeNameEn
                ? (locale === "ar" ? requirement.specimenTypeNameAr || requirement.specimenTypeNameEn : requirement.specimenTypeNameEn)
                : specimen.specimenType ? localizedName(specimen.specimenType) : tr(locale, "Not configured", "غير مهيأة"),
              containerName: requirement?.containerNameEn
                ? `${requirement.containerCode || "—"} — ${locale === "ar" ? requirement.containerNameAr || requirement.containerNameEn : requirement.containerNameEn}`
                : specimen.container ? `${specimen.container.code} — ${localizedName(specimen.container)}` : "—",
              testCodes: specimen.orderItems.map(link => link.orderItem.testCodeSnapshot),
              requiredVolume: requirement?.requiredVolume || null,
              requiredVolumeUnit: requirement?.requiredVolumeUnit || null,
              patientPreparation: requirement?.patientPreparation || [],
              collectionInstructions: requirement?.collectionInstructions || [],
              requirementsFinalized: Boolean(requirement),
              configurationComplete: requirement?.configurationComplete === true,
              parentBarcode: specimen.parentSpecimen?.barcode || null,
              secondaryOptions,
            }}
          />;
        })
      }
    </div>

    <section className="table-card detail-section">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Failed Collection History", "سجل محاولات السحب الفاشلة")}</h2><span>{tr(locale, "Recent audited attempts", "محاولات حديثة مدققة")}</span></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>{tr(locale, "Time", "الوقت")}</th>
            <th>{tr(locale, "Patient", "المريض")}</th>
            <th>{tr(locale, "Failed barcode", "الباركود الفاشل")}</th>
            <th>{tr(locale, "Reason", "السبب")}</th>
            <th>{tr(locale, "Collector", "جامع العينة")}</th>
            <th>{tr(locale, "Recollection", "إعادة السحب")}</th>
          </tr></thead>
          <tbody>
            {recentFailedAttempts.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No failed collection attempts are recorded for this branch.", "لا توجد محاولات سحب فاشلة مسجلة لهذا الفرع.")}</td></tr> :
              recentFailedAttempts.map(attempt => <tr key={attempt.id}>
                <td>{attempt.attemptedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td><strong>{attempt.specimen.order.patient.patientNumber}</strong><br/><small>{patientName(attempt.specimen.order.patient)}</small></td>
                <td><span className="barcode-text">{attempt.specimen.barcode}</span></td>
                <td><strong>{attempt.failureReasonCode || "—"}</strong><br/><small>{attempt.failureReasonText || "—"}</small></td>
                <td>{locale === "ar" ? attempt.collectorNameArSnapshot || attempt.collectorNameEnSnapshot : attempt.collectorNameEnSnapshot}</td>
                <td>{attempt.replacementSpecimen ? <Link className="table-link" href={`/phlebotomy?branch=${selectedBranchId}&specimen=${attempt.replacementSpecimen.id}`}>{attempt.replacementSpecimen.barcode}</Link> : "—"}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
