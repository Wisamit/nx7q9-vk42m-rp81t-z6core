import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenActions } from "@/components/specimen-actions";
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

  const [branches, containers, specimen] = await Promise.all([
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
    barcode ? prisma.specimen.findFirst({
      where: {
        organizationId: session.user.organizationId,
        barcode,
        OR: [
          { currentBranchId: { in: branchIds } },
          { order: { orderingBranchId: { in: branchIds } } },
        ],
      },
      include: {
        specimenType: true,
        container: true,
        currentBranch: true,
        collectionBranch: true,
        orderItems: { include: { orderItem: true } },
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
            branch: { select: { code: true } },
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
          {canCollect && (specimen.status !== "PLANNED" || Boolean(requirement)) && <Link className="secondary-link" href={`/specimens/${specimen.id}/label`}>{tr(locale, "Print Label", "طباعة الملصق")}</Link>}
          <Link className="secondary-link" href={`/orders/${specimen.orderId}`}>{tr(locale, "Open Order", "فتح الطلب")}</Link>
        </div>
      </div>

      <div className="specimen-metadata">
        <div><span>{tr(locale, "Specimen", "العينة")}</span><strong>{specimen.specimenType ? localizedName(specimen.specimenType) : tr(locale, "Not configured", "غير مهيأة")}</strong></div>
        <div><span>{tr(locale, "Container", "الحاوية")}</span><strong>{specimen.container ? localizedName(specimen.container) : "—"}</strong></div>
        <div><span>{tr(locale, "Order branch", "فرع الطلب")}</span><strong>{localizedName(specimen.order.orderingBranch)}</strong></div>
        <div><span>{tr(locale, "Current branch", "الفرع الحالي")}</span><strong>{specimen.currentBranch ? localizedName(specimen.currentBranch) : "—"}</strong></div>
        <div><span>{tr(locale, "Linked tests", "الفحوصات المرتبطة")}</span><strong>{specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
        <div><span>{tr(locale, "Required volume", "الحجم المطلوب")}</span><strong>{specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Derived aliquot", "جزء مشتق") : requirement?.requiredVolume ? `${requirement.requiredVolume} ${requirement.requiredVolumeUnit || ""}` : requirement ? tr(locale, "Not specified", "غير محدد") : tr(locale, "Not finalized", "غير مثبت")}</strong></div>
        <div><span>{tr(locale, "Available volume", "الحجم المتاح")}</span><strong>{specimen.remainingVolume ? `${specimen.remainingVolume.toFixed(3)} ${specimen.remainingVolumeUnit || ""}` : "—"}</strong></div>
        <div><span>{tr(locale, "Lineage", "التسلسل")}</span><strong>{specimen.parentSpecimen
  ? `${specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Aliquot of", "جزء مشتق من") : tr(locale, "Recollection after", "إعادة سحب بعد")} ${specimen.parentSpecimen.barcode}`
  : tr(locale, "Primary specimen", "عينة أصلية")}</strong></div>
        <div><span>{tr(locale, "Physical storage", "التخزين الفعلي")}</span><strong>{specimen.storageLocation || "—"}</strong></div>
      </div>

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
        branches={branches.map(branch => ({
          id: branch.id,
          code: branch.code,
          nameEn: localizedName(branch),
        }))}
        activeBranchId={session.activeBranchId}
        locale={locale}
        canCollect={canCollect}
        canReceive={canReceive}
        canReject={canReject}
      />

      <SpecimenAliquotManager
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
          .filter(link => link.orderItem.status !== "CANCELLED")
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
