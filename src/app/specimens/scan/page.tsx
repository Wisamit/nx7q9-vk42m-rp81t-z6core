import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenActions } from "@/components/specimen-actions";
import { SystemDateText } from "@/components/system-date-text";
import { SpecimenAliquotManager } from "@/components/specimen-aliquot-manager";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function SpecimenScanPage({
  searchParams,
}: {
  searchParams: Promise<{ barcode?: string }>;
}) {
  const session = await requirePermission("specimens.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const canCollect = permissions.has("specimens.collect");
  const canReceive = permissions.has("specimens.receive");
  const canReject = permissions.has("specimens.reject");
  const canAliquot = permissions.has("specimens.aliquot");
  const params = await searchParams;
  const barcode = params.barcode?.trim().slice(0, 80) || "";
  const branchIds = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId);

  const [branches, containers, rejectionReasons, specimen] = await Promise.all([
    prisma.branch.findMany({
      where: { id: { in: branchIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.container.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.specimenRejectionReason.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    barcode ? prisma.specimen.findFirst({
      where: {
        organizationId: session.user.organizationId,
        barcode,
        currentBranchId: { in: branchIds },
      },
      include: {
        specimenType: true,
        container: true,
        currentBranch: true,
        collectionBranch: true,
        orderItems: { include: { orderItem: true } },
        collectionAttempts: {
          orderBy: { attemptedAt: "desc" },
          take: 20,
          include: { collector: true, branch: true, replacementSpecimen: true },
        },
        receptionAssessments: {
          orderBy: { receivedAt: "desc" },
          take: 1,
          include: { receivedBy: true, branch: true },
        },
        rejectionRecords: {
          orderBy: { rejectedAt: "desc" },
          take: 20,
          include: {
            branch: true,
            rejectedBy: true,
            affectedLinks: { include: { orderItem: true } },
          },
        },
        parentSpecimen: { select: { id: true, barcode: true } },
        childSpecimens: {
          where: { parentRelationType: "ALIQUOT" },
          select: {
            id: true,
            barcode: true,
            status: true,
            volume: true,
            volumeUnit: true,
            remainingVolume: true,
            remainingVolumeUnit: true,
            storageLocation: true,
          },
          orderBy: { createdAt: "desc" },
        },
        sourceUsageEvents: {
          include: {
            orderItem: { select: { testCodeSnapshot: true } },
            childSpecimen: { select: { barcode: true } },
            usedBy: { select: { displayNameEn: true, displayNameAr: true } },
            branch: { select: { code: true, timezone: true } },
          },
          orderBy: { usedAt: "desc" },
          take: 50,
        },
        events: { orderBy: { occurredAt: "asc" } },
        order: { include: { patient: true, orderingBranch: true } },
      },
    }) : null,
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const requirement = specimen?.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Pre-Analytical Workflow", "مرحلة ما قبل التحليل")}</p>
        <h1>{tr(locale, "Specimen Scan Station", "محطة مسح العينات")}</h1>
        <p className="muted">{tr(locale, "Scan the exact Code 128 specimen barcode. Partial matches are intentionally not accepted.", "امسح باركود Code 128 الكامل للعينة. لا يتم قبول المطابقة الجزئية عمدًا.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens">{tr(locale, "Specimen Queue", "قائمة العينات")}</Link>
      </div>
    </header>

    <section className="table-card">
      <form className="inline-search" action="/specimens/scan" method="get">
        <input name="barcode" defaultValue={barcode} maxLength={80} autoFocus autoComplete="off" placeholder={tr(locale, "Scan specimen barcode…", "امسح باركود العينة…")} />
        <button className="primary-button">{tr(locale, "Find Exact Barcode", "البحث بالباركود الكامل")}</button>
        {barcode && <Link className="secondary-link" href="/specimens/scan">{tr(locale, "Clear", "مسح")}</Link>}
      </form>
    </section>

    {barcode && !specimen && <section className="detail-card"><p className="form-error">
      {tr(locale, "No specimen with this exact barcode is available in your branch scope.", "لا توجد عينة بهذا الباركود الكامل ضمن نطاق فروعك.")}
    </p></section>}

    {specimen && <section className="detail-card specimen-card">
      <div className="specimen-card-head">
        <div>
          <span className={"status-badge status-" + specimen.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, specimen.status)}</span>
          <h2 className="barcode-text">{specimen.barcode}</h2>
          <p className="muted">{specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {locale === "ar" ? specimen.order.patient.fullNameAr || specimen.order.patient.fullNameEn : specimen.order.patient.fullNameEn}</p>
        </div>
        <div className="header-actions">
          {canCollect && specimen.status === "PLANNED" && <Link className="primary-button" href={`/phlebotomy?specimen=${specimen.id}`}>{tr(locale, "Open Phlebotomy", "فتح شاشة السحب")}</Link>}
          {canCollect && !["COLLECTION_FAILED","REJECTED","DISPOSED"].includes(specimen.status) && (specimen.status !== "PLANNED" || Boolean(requirement)) && <Link className="secondary-link" href={`/specimens/${specimen.id}/label`}>{tr(locale, "Print Label", "طباعة الملصق")}</Link>}
          <Link className="secondary-link" href={`/orders/${specimen.orderId}`}>{tr(locale, "Open Order", "فتح الطلب")}</Link>
        </div>
      </div>

      {specimen.status === "QUARANTINED" && <div className="specimen-rejection" role="alert"><strong>{tr(locale, "Clinical quarantine — processing blocked", "حجر سريري — المعالجة محظورة")}</strong><p>{tr(locale, "This specimen has an unresolved reception exception. Only the documented rejection/recollection pathway is permitted until a clinical release policy is approved.", "هذه العينة عليها مخالفة استلام لم تُحل. يُسمح فقط بمسار الرفض وإعادة السحب الموثق حتى اعتماد سياسة رفع الحجر السريري.")}</p></div>}

      <div className="specimen-metadata">
        <div><span>{tr(locale, "Specimen", "العينة")}</span><strong>{specimen.specimenType ? localizedName(specimen.specimenType) : tr(locale, "Not configured", "غير مهيأة")}</strong></div>
        <div><span>{tr(locale, "Container", "الحاوية")}</span><strong>{specimen.container ? localizedName(specimen.container) : "—"}</strong></div>
        <div><span>{tr(locale, "Order branch", "فرع الطلب")}</span><strong>{localizedName(specimen.order.orderingBranch)}</strong></div>
        <div><span>{tr(locale, "Current branch", "الفرع الحالي")}</span><strong>{specimen.currentBranch ? localizedName(specimen.currentBranch) : "—"}</strong></div>
        <div><span>{tr(locale, "Active tests", "الفحوصات الفعالة")}</span><strong>{specimen.orderItems.filter(link => link.status === "ACTIVE").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
        <div><span>{tr(locale, "Failed collection links", "روابط فشل السحب")}</span><strong>{specimen.orderItems.filter(link => link.status === "FAILED_COLLECTION").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
        <div><span>{tr(locale, "Rejected test links", "روابط الفحوصات المرفوضة")}</span><strong>{specimen.orderItems.filter(link => link.status === "REJECTED").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
        <div><span>{tr(locale, "Required volume", "الحجم المطلوب")}</span><strong>{specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Derived aliquot", "جزء مشتق") : requirement?.requiredVolume ? `${requirement.requiredVolume} ${requirement.requiredVolumeUnit || ""}` : requirement ? tr(locale, "Not specified", "غير محدد") : tr(locale, "Not finalized", "غير مثبت")}</strong></div>
        <div><span>{tr(locale, "Available volume", "الحجم المتاح")}</span><strong>{specimen.remainingVolume ? `${specimen.remainingVolume.toFixed(3)} ${specimen.remainingVolumeUnit || ""}` : "—"}</strong></div>
        <div><span>{tr(locale, "Lineage", "التسلسل")}</span><strong>{specimen.parentSpecimen
  ? `${specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Aliquot of", "جزء مشتق من") : tr(locale, "Recollection after", "إعادة سحب بعد")} ${specimen.parentSpecimen.barcode}`
  : tr(locale, "Primary specimen", "عينة أصلية")}</strong></div>
        <div><span>{tr(locale, "Physical storage", "التخزين الفعلي")}</span><strong>{specimen.storageLocation || "—"}</strong></div>
      </div>

      {specimen.collectionAttempts[0] && <div className={specimen.collectionAttempts[0].outcome === "FAILED" ? "specimen-rejection" : "form-warning"}>
        <strong>{tr(locale, "Latest collection attempt", "آخر محاولة سحب")}</strong>
        <span>
          <SystemDateText value={specimen.collectionAttempts[0].attemptedAt.toISOString()} timeZone={specimen.collectionAttempts[0].branch.timezone} />
          {" · "}{specimen.collectionAttempts[0].branchCodeSnapshot}
          {" · "}{locale === "ar" ? specimen.collectionAttempts[0].collectorNameArSnapshot || specimen.collectionAttempts[0].collectorNameEnSnapshot : specimen.collectionAttempts[0].collectorNameEnSnapshot}
          {" · "}{specimen.collectionAttempts[0].outcome === "SUCCESS" ? tr(locale, "Success", "ناجحة") : tr(locale, "Failed", "فاشلة")}
          {specimen.collectionAttempts[0].failureReasonCode ? ` · ${specimen.collectionAttempts[0].failureReasonCode}` : ""}
          {specimen.collectionAttempts[0].replacementSpecimen ? ` · ${tr(locale, "Replacement", "البديل")}: ${specimen.collectionAttempts[0].replacementSpecimen.barcode}` : ""}
        </span>
      </div>}

      {specimen.receptionAssessments[0] && <div className="form-warning">
        <strong>{tr(locale, "Latest reception assessment", "آخر تقييم استلام")}</strong>
        <span>
          <SystemDateText value={specimen.receptionAssessments[0].receivedAt.toISOString()} timeZone={specimen.receptionAssessments[0].branch.timezone} />
          {" · "}{specimen.receptionAssessments[0].branch.code}
          {" · "}{locale === "ar" ? specimen.receptionAssessments[0].receivedBy.displayNameAr || specimen.receptionAssessments[0].receivedBy.displayNameEn : specimen.receptionAssessments[0].receivedBy.displayNameEn}
          {" · "}{tr(locale, "Label", "الملصق")}: {specimen.receptionAssessments[0].labelAssessment}
          {" · "}{tr(locale, "Condition", "الحالة")}: {specimen.receptionAssessments[0].conditionCode}
          {specimen.receptionAssessments[0].temperatureC != null ? ` · ${tr(locale, "Temp", "الحرارة")}: ${specimen.receptionAssessments[0].temperatureC.toFixed(2)} °C` : ""}
        </span>
        {specimen.receptionAssessments[0].discrepancyText && <small>{specimen.receptionAssessments[0].discrepancyText}</small>}
      </div>}

      <SpecimenActions
        specimenId={specimen.id}
        orderId={specimen.orderId}
        barcode={specimen.barcode}
        status={specimen.status}
        specimenTypeConfigured={Boolean(specimen.specimenTypeId)}
        requirementsFinalized={Boolean(requirement)}
        requiredVolume={requirement?.requiredVolume || null}
        requiredVolumeUnit={requirement?.requiredVolumeUnit || null}
        collectionInstructions={requirement?.collectionInstructions || []}
        expectedContainerCode={specimen.container?.code || null}
        orderItems={specimen.orderItems
          .filter(link => link.status === "ACTIVE" && link.orderItem.status !== "CANCELLED")
          .map(link => ({
            id: link.orderItemId,
            code: link.orderItem.testCodeSnapshot,
            name: locale === "ar"
              ? link.orderItem.testNameArSnapshot || link.orderItem.testNameEnSnapshot
              : link.orderItem.testNameEnSnapshot,
          }))}
        rejectionReasons={rejectionReasons.map(reason => ({
          id: reason.id,
          code: reason.code,
          name: locale === "ar" ? reason.nameAr || reason.nameEn : reason.nameEn,
        }))}
        branches={branches.map(branch => ({
          id: branch.id,
          code: branch.code,
          nameEn: localizedName(branch),
        }))}
        activeBranchId={session.activeBranchId}
        currentBranchId={specimen.currentBranchId}
        locale={locale}
        canCollect={canCollect}
        canReceive={canReceive}
        canReject={canReject}
      />

      {specimen.collectionAttempts.length > 0 && <details className="specimen-history">
        <summary>{tr(locale, "Collection attempt history", "سجل محاولات السحب")} ({specimen.collectionAttempts.length})</summary>
        <div className="summary-list">
          {specimen.collectionAttempts.map(attempt => <div key={attempt.id}>
            <span><SystemDateText value={attempt.attemptedAt.toISOString()} timeZone={attempt.branch.timezone} /> · {attempt.branchCodeSnapshot} · {locale === "ar" ? attempt.collectorNameArSnapshot || attempt.collectorNameEnSnapshot : attempt.collectorNameEnSnapshot}</span>
            <strong>{attempt.outcome === "SUCCESS" ? tr(locale, "Successful collection", "سحب ناجح") : tr(locale, "Failed collection", "فشل السحب")} · {attempt.collectionLocationType}{attempt.collectionLocationText ? ` · ${attempt.collectionLocationText}` : ""}</strong>
            <small>{attempt.outcome === "FAILED" ? `${attempt.failureReasonCode || "—"} · ${attempt.failureReasonText || "—"}` : `${attempt.volume?.toFixed(3) || "—"} ${attempt.volumeUnit || ""}`}{attempt.replacementSpecimen ? ` · ${tr(locale, "Recollection", "إعادة السحب")}: ${attempt.replacementSpecimen.barcode}` : ""}</small>
          </div>)}
        </div>
      </details>}

      {specimen.rejectionRecords.length > 0 && <details className="specimen-history">
        <summary>{tr(locale, "Rejection history", "سجل الرفض")} ({specimen.rejectionRecords.length})</summary>
        <div className="summary-list">
          {specimen.rejectionRecords.map(rejection => <div key={rejection.id}>
            <span><SystemDateText value={rejection.rejectedAt.toISOString()} timeZone={rejection.branch.timezone} /> · {locale === "ar" ? rejection.rejectedBy.displayNameAr || rejection.rejectedBy.displayNameEn : rejection.rejectedBy.displayNameEn}</span>
            <strong>{rejection.scope === "WHOLE_SPECIMEN" ? tr(locale, "Whole specimen", "العينة كاملة") : tr(locale, "Selected tests", "فحوصات محددة")} · {locale === "ar" ? rejection.reasonNameArSnapshot || rejection.reasonNameEnSnapshot : rejection.reasonNameEnSnapshot}</strong>
            <small>{rejection.affectedLinks.map(link => link.orderItem.testCodeSnapshot).join(", ")} · {rejection.reasonDetails}</small>
          </div>)}
        </div>
      </details>}

      <SpecimenAliquotManager
        currentBranchId={specimen.currentBranchId}
        canManageStorageSettings={permissions.has("settings.manage")}
        specimenId={specimen.id}
        status={specimen.status}
        originalVolume={specimen.volume?.toFixed(3) || null}
        originalVolumeUnit={specimen.volumeUnit}
        remainingVolume={specimen.remainingVolume?.toFixed(3) || null}
        remainingVolumeUnit={specimen.remainingVolumeUnit}
        storageLocation={specimen.storageLocation}
        containers={containers.map(item => ({
          id: item.id,
          code: item.code,
          name: localizedName(item),
        }))}
        orderItems={specimen.orderItems
          .filter(link => link.status === "ACTIVE" && link.orderItem.status !== "CANCELLED")
          .map(link => ({
            id: link.orderItemId,
            code: link.orderItem.testCodeSnapshot,
            name: locale === "ar"
              ? link.orderItem.testNameArSnapshot || link.orderItem.testNameEnSnapshot
              : link.orderItem.testNameEnSnapshot,
          }))}
        childAliquots={specimen.childSpecimens.map(child => ({
          id: child.id,
          barcode: child.barcode,
          status: statusLabel(locale, child.status),
          volume: child.volume?.toFixed(3) || null,
          remainingVolume: child.remainingVolume?.toFixed(3) || null,
          volumeUnit: child.remainingVolumeUnit || child.volumeUnit,
          storageLocation: child.storageLocation,
        }))}
        usageEvents={specimen.sourceUsageEvents.map(item => ({
          id: item.id,
          usageType: item.usageType,
          volumeUsed: item.volumeUsed.toFixed(3),
          volumeUnit: item.volumeUnit,
          usedAt: item.usedAt.toISOString(),
          notes: item.notes,
          orderItemCode: item.orderItem?.testCodeSnapshot || null,
          childBarcode: item.childSpecimen?.barcode || null,
          usedByName: locale === "ar" ? item.usedBy.displayNameAr || item.usedBy.displayNameEn : item.usedBy.displayNameEn,
          branchCode: item.branch.code,
        }))}
        canManage={canAliquot}
        canPrintLabels={canCollect}
        locale={locale}
      />
    </section>}
  </main>;
}
