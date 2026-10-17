import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenActions } from "@/components/specimen-actions";
import { SpecimenAliquotManager } from "@/components/specimen-aliquot-manager";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

export const dynamic = "force-dynamic";

export default async function SpecimensPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requirePermission("specimens.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const canCollect = permissions.has("specimens.collect");
  const canReceive = permissions.has("specimens.receive");
  const canReject = permissions.has("specimens.reject");
  const canAliquot = permissions.has("specimens.aliquot");
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [specimens, branches, containers, rejectionReasons] = await Promise.all([
    prisma.specimen.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { currentBranchId: { in: branchIds } },
          { order: { orderingBranchId: { in: branchIds } } },
        ],
        ...(status && ["PLANNED","COLLECTION_FAILED","COLLECTED","RECEIVED","IN_TRANSIT","IN_PROCESS","REJECTED","DISPOSED"].includes(status)
          ? { status: status as "PLANNED" | "COLLECTION_FAILED" | "COLLECTED" | "RECEIVED" | "IN_TRANSIT" | "IN_PROCESS" | "REJECTED" | "DISPOSED" }
          : {}),
        ...(q ? {
          AND: [{
            OR: [
              { barcode: { contains: q } },
              { order: { accessionNumber: { contains: q } } },
              { order: { patient: { patientNumber: { contains: q } } } },
              { order: { patient: { fullNameEn: { contains: q } } } },
              { order: { patient: { phone: { contains: q } } } },
            ],
          }],
        } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        specimenType: true,
        container: true,
        currentBranch: true,
        collectionBranch: true,
        collectedBy: true,
        receivedBy: true,
        rejectedBy: true,
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
        events: { orderBy: { occurredAt: "asc" }, include: { actor: true, branch: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
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
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) => locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) => locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;
  const eventLabel = (value: string) => ({
    CREATED: tr(locale, "Created", "تم الإنشاء"),
    COLLECTION_FAILED: tr(locale, "Collection failed", "فشل السحب"),
    COLLECTED: tr(locale, "Collected", "تم الجمع"),
    RECEIVED: tr(locale, "Received", "تم الاستلام"),
    REJECTED: tr(locale, "Rejected", "مرفوض"),
    RELOCATED: tr(locale, "Relocated", "تم تغيير الموقع"),
    TRANSFERRED: tr(locale, "Transferred", "تم النقل"),
    PROCESSING_STARTED: tr(locale, "Processing started", "بدأت المعالجة"),
    ALIQUOT_CREATED: tr(locale, "Aliquot created", "تم إنشاء جزء مشتق"),
    VOLUME_RECONCILED: tr(locale, "Volume reconciled", "تمت تسوية الحجم"),
    USED: tr(locale, "Specimen used", "تم استخدام العينة"),
    DISPOSED: tr(locale, "Disposed", "تم التخلص"),
  }[value] || value);

  const planned = specimens.filter(item => item.status === "PLANNED").length;
  const collectionFailed = specimens.filter(item => item.status === "COLLECTION_FAILED").length;
  const collected = specimens.filter(item => item.status === "COLLECTED").length;
  const received = specimens.filter(item => ["RECEIVED","IN_PROCESS"].includes(item.status)).length;
  const rejected = specimens.filter(item => item.status === "REJECTED").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Pre-Analytical Workflow", "مرحلة ما قبل التحليل")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="specimen" size={25} />{tr(locale, "Specimens & Barcodes", "العينات والباركود")}</h1>
        <p className="muted">{tr(locale, "Trace each specimen from planned collection through receipt, rejection and recollection using organization-unique barcodes.", "تتبع كل عينة من التخطيط للجمع حتى الاستلام والرفض وإعادة السحب باستخدام باركود فريد على مستوى المؤسسة.")}</p>
      </div>
      <div className="header-actions">
        {canCollect && <Link className="secondary-link" href="/phlebotomy"><SystemIcon name="specimen" size={15} />{tr(locale, "Phlebotomy", "سحب العينات")}</Link>}
        <Link className="secondary-link" href="/specimens/retention">{tr(locale, "Retention & Disposal", "الاحتفاظ والإتلاف")}</Link>
        <Link className="secondary-link" href="/specimens/scan"><SystemIcon name="search" size={15} />{tr(locale, "Scan Station", "محطة المسح")}</Link>
        <Link className="secondary-link" href="/orders"><SystemIcon name="orders" size={15} />{tr(locale, "Orders", "الطلبات")}</Link>
        <Link className="secondary-link" href="/transfers"><SystemIcon name="transfer" size={15} />{tr(locale, "Transfers", "النقل بين الفروع")}</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Planned", "مخطط")}</span><strong>{planned}</strong><small>{tr(locale, "awaiting collection", "بانتظار الجمع")}</small></article>
      <article className={collectionFailed ? "summary-attention" : ""}><span>{tr(locale, "Collection failed", "فشل السحب")}</span><strong>{collectionFailed}</strong><small>{tr(locale, "closed barcode / recollection created", "باركود مغلق / تم إنشاء إعادة سحب")}</small></article>
      <article><span>{tr(locale, "Collected", "تم الجمع")}</span><strong>{collected}</strong><small>{tr(locale, "awaiting receipt / routing", "بانتظار الاستلام / التوجيه")}</small></article>
      <article><span>{tr(locale, "Lab ready", "جاهزة للمختبر")}</span><strong>{received}</strong><small>{tr(locale, "received or in process", "مستلمة أو قيد المعالجة")}</small></article>
      <article className={rejected ? "summary-attention" : ""}><span>{tr(locale, "Rejected", "مرفوضة")}</span><strong>{rejected}</strong><small>{tr(locale, "requires attention / recollection", "تتطلب متابعة / إعادة سحب")}</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Specimen Work Queue", "قائمة عمل العينات")}</h2><span>{specimens.length} {tr(locale, "shown", "معروضة")}</span></div>
        <form className="inline-search" action="/specimens" method="get">
          <input name="q" defaultValue={q} placeholder={tr(locale, "Scan barcode or search order / patient…", "امسح الباركود أو ابحث بالطلب / المريض…")} autoFocus />
          <select name="status" defaultValue={status}>
            <option value="">{tr(locale, "All statuses", "كل الحالات")}</option>
            <option value="PLANNED">{statusLabel(locale, "PLANNED")}</option>
            <option value="COLLECTION_FAILED">{statusLabel(locale, "COLLECTION_FAILED")}</option>
            <option value="COLLECTED">{statusLabel(locale, "COLLECTED")}</option>
            <option value="RECEIVED">{statusLabel(locale, "RECEIVED")}</option>
            <option value="IN_TRANSIT">{statusLabel(locale, "IN_TRANSIT")}</option>
            <option value="IN_PROCESS">{statusLabel(locale, "IN_PROCESS")}</option>
            <option value="REJECTED">{statusLabel(locale, "REJECTED")}</option>
          </select>
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Search", "بحث")}</button>
          {(q || status) && <Link className="secondary-link" href="/specimens">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>
    </section>

    <div className="specimen-card-list">
      {specimens.length === 0 ? <section className="detail-card"><p className="empty-state">{tr(locale, "No matching specimens.", "لا توجد عينات مطابقة.")}</p></section> :
        specimens.map(specimen => {
          const requirement = specimen.events
            .map(event => specimenRequirementSnapshotFromDetails(event.details))
            .find(Boolean) || null;
          const recentEvents = [...specimen.events].slice(-5).reverse();
          return <section className="detail-card specimen-card" key={specimen.id}>
            <div className="specimen-card-head">
              <div>
                <span className={"status-badge status-" + specimen.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, specimen.status)}</span>
                <h2 className="barcode-text">{specimen.barcode}</h2>
                <p className="muted">{specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {patientName(specimen.order.patient)}</p>
              </div>
              <div className="header-actions">
                {canCollect && !["COLLECTION_FAILED","REJECTED","DISPOSED"].includes(specimen.status) && (specimen.status !== "PLANNED" || requirement?.configurationComplete === true) && <Link className="secondary-link" href={`/specimens/${specimen.id}/label`}>{tr(locale, "Print Label", "طباعة الملصق")}</Link>}
                <Link className="secondary-link" href={`/orders/${specimen.orderId}`}><SystemIcon name="orders" size={15} />{tr(locale, "Open Order", "فتح الطلب")}</Link>
              </div>
            </div>

            <div className="specimen-metadata">
              <div><span>{tr(locale, "Specimen", "العينة")}</span><strong>{requirement?.specimenTypeNameEn ? (locale === "ar" ? requirement.specimenTypeNameAr || requirement.specimenTypeNameEn : requirement.specimenTypeNameEn) : specimen.specimenType ? localizedName(specimen.specimenType) : tr(locale, "Not configured", "غير مهيأة")}</strong></div>
              <div><span>{tr(locale, "Container", "الحاوية")}</span><strong>{requirement?.containerNameEn ? (locale === "ar" ? requirement.containerNameAr || requirement.containerNameEn : requirement.containerNameEn) : specimen.container ? localizedName(specimen.container) : "—"}</strong></div>
              <div><span>{tr(locale, "Order branch", "فرع الطلب")}</span><strong>{localizedName(specimen.order.orderingBranch)}</strong></div>
              <div><span>{tr(locale, "Current branch", "الفرع الحالي")}</span><strong>{specimen.currentBranch ? localizedName(specimen.currentBranch) : "—"}</strong></div>
              <div><span>{tr(locale, "Active tests", "الفحوصات الفعالة")}</span><strong>{specimen.orderItems.filter(link => link.status === "ACTIVE").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
              <div><span>{tr(locale, "Failed collection links", "روابط فشل السحب")}</span><strong>{specimen.orderItems.filter(link => link.status === "FAILED_COLLECTION").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
              <div><span>{tr(locale, "Rejected test links", "روابط الفحوصات المرفوضة")}</span><strong>{specimen.orderItems.filter(link => link.status === "REJECTED").map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
              <div><span>{tr(locale, "Required volume", "الحجم المطلوب")}</span><strong>{specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Derived aliquot", "جزء مشتق") : requirement?.requiredVolume ? `${requirement.requiredVolume} ${requirement.requiredVolumeUnit || ""}` : requirement ? tr(locale, "Not specified", "غير محدد") : tr(locale, "Not finalized", "غير مثبت")}</strong></div>
              <div><span>{tr(locale, "Storage", "التخزين")}</span><strong>{requirement?.storageConditions || "—"}</strong></div>
              <div><span>{tr(locale, "Stability", "الثبات")}</span><strong>{requirement?.stabilityMinutes == null ? "—" : `${requirement.stabilityMinutes} ${tr(locale, "min", "دقيقة")}`}</strong></div>
              <div><span>{tr(locale, "Collected", "تم الجمع")}</span><strong>{specimen.collectedAt ? <SystemDateText value={specimen.collectedAt.toISOString()} timeZone={specimen.order.orderingBranch.timezone} /> : "—"}</strong></div>
              <div><span>{tr(locale, "Received", "تم الاستلام")}</span><strong>{specimen.receivedAt ? <SystemDateText value={specimen.receivedAt.toISOString()} timeZone={specimen.currentBranch?.timezone || specimen.order.orderingBranch.timezone} /> : "—"}</strong></div>
              <div><span>{tr(locale, specimen.parentRelationType === "ALIQUOT" ? "Initial aliquot volume" : "Collected volume", specimen.parentRelationType === "ALIQUOT" ? "الحجم الابتدائي للجزء" : "الحجم المجموعة")}</span><strong>{specimen.volume ? `${specimen.volume.toFixed(3)} ${specimen.volumeUnit || ""}` : "—"}</strong></div>
              <div><span>{tr(locale, "Available volume", "الحجم المتاح")}</span><strong>{specimen.remainingVolume ? `${specimen.remainingVolume.toFixed(3)} ${specimen.remainingVolumeUnit || ""}` : "—"}</strong></div>
              <div><span>{tr(locale, "Lineage", "التسلسل")}</span><strong>{specimen.parentSpecimen
  ? `${specimen.parentRelationType === "ALIQUOT" ? tr(locale, "Aliquot of", "جزء مشتق من") : tr(locale, "Recollection after", "إعادة سحب بعد")} ${specimen.parentSpecimen.barcode}`
  : tr(locale, "Primary specimen", "عينة أصلية")}</strong></div>
              <div><span>{tr(locale, "Physical storage", "التخزين الفعلي")}</span><strong>{specimen.storageLocation || "—"}</strong></div>
              <div><span>{tr(locale, "Sharing", "المشاركة")}</span><strong>{requirement ? requirement.shared ? tr(locale, "Shared tube", "أنبوب مشترك") : tr(locale, "Dedicated", "مخصص") : "—"}</strong></div>
            </div>

            {requirement && requirement.patientPreparation.length > 0 && <div className="form-warning">
              <strong>{tr(locale, "Patient preparation", "تحضير المريض")}</strong>
              <span>{requirement.patientPreparation.join(" · ")}</span>
            </div>}

            {requirement && requirement.collectionInstructions.length > 0 && <div className="form-warning">
              <strong>{tr(locale, "Collection instructions", "تعليمات الجمع")}</strong>
              <span>{requirement.collectionInstructions.join(" · ")}</span>
            </div>}

            {specimen.collectionAttempts[0] && <div className={specimen.collectionAttempts[0].outcome === "FAILED" ? "specimen-rejection" : "form-warning"}>
              <strong>{tr(locale, "Latest collection attempt", "آخر محاولة سحب")}</strong>
              <span>
                {<SystemDateText value={specimen.collectionAttempts[0].attemptedAt.toISOString()} timeZone={specimen.order.orderingBranch.timezone} />}
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
                {<SystemDateText value={specimen.receptionAssessments[0].receivedAt.toISOString()} timeZone={specimen.receptionAssessments[0].branch.timezone} />}
                {" · "}{specimen.receptionAssessments[0].branch.code}
                {" · "}{userName(specimen.receptionAssessments[0].receivedBy)}
                {" · "}{tr(locale, "Label", "الملصق")}: {specimen.receptionAssessments[0].labelAssessment}
                {" · "}{tr(locale, "Condition", "الحالة")}: {specimen.receptionAssessments[0].conditionCode}
                {specimen.receptionAssessments[0].temperatureC != null ? ` · ${tr(locale, "Temp", "الحرارة")}: ${specimen.receptionAssessments[0].temperatureC.toFixed(2)} °C` : ""}
              </span>
              {specimen.receptionAssessments[0].discrepancyText && <small>{specimen.receptionAssessments[0].discrepancyText}</small>}
            </div>}

            {specimen.status === "REJECTED" && <div className="specimen-rejection">
              <strong>{specimen.rejectionReasonCode}</strong>
              <span>{specimen.rejectionReasonText}</span>
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
              branches={branches}
              activeBranchId={session.activeBranchId}
              currentBranchId={specimen.currentBranchId}
              locale={locale}
              canCollect={canCollect}
              canReceive={canReceive}
              canReject={canReject}
            />

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
                usedByName: userName(item.usedBy),
                branchCode: item.branch.code,
                branchTimeZone: item.branch.timezone,
              }))}
              canManage={canAliquot}
              canPrintLabels={canCollect}
              locale={locale}
            />

            {specimen.collectionAttempts.length > 0 && <details className="specimen-history">
              <summary>{tr(locale, "Collection attempt history", "سجل محاولات السحب")} ({specimen.collectionAttempts.length})</summary>
              <div className="summary-list">
                {specimen.collectionAttempts.map(attempt => <div key={attempt.id}>
                  <span>{<SystemDateText value={attempt.attemptedAt.toISOString()} timeZone={specimen.order.orderingBranch.timezone} />} · {attempt.branchCodeSnapshot} · {locale === "ar" ? attempt.collectorNameArSnapshot || attempt.collectorNameEnSnapshot : attempt.collectorNameEnSnapshot}</span>
                  <strong>{attempt.outcome === "SUCCESS" ? tr(locale, "Successful collection", "سحب ناجح") : tr(locale, "Failed collection", "فشل السحب")} · {attempt.collectionLocationType}{attempt.collectionLocationText ? ` · ${attempt.collectionLocationText}` : ""}</strong>
                  <small>{attempt.outcome === "FAILED" ? `${attempt.failureReasonCode || "—"} · ${attempt.failureReasonText || "—"}` : `${attempt.volume?.toFixed(3) || "—"} ${attempt.volumeUnit || ""}`}{attempt.replacementSpecimen ? ` · ${tr(locale, "Recollection", "إعادة السحب")}: ${attempt.replacementSpecimen.barcode}` : ""}</small>
                </div>)}
              </div>
            </details>}

            {specimen.rejectionRecords.length > 0 && <details className="specimen-history">
              <summary>{tr(locale, "Rejection history", "سجل الرفض")} ({specimen.rejectionRecords.length})</summary>
              <div className="summary-list">
                {specimen.rejectionRecords.map(rejection => <div key={rejection.id}>
                  <span>{<SystemDateText value={rejection.rejectedAt.toISOString()} timeZone={specimen.order.orderingBranch.timezone} />} · {userName(rejection.rejectedBy)}</span>
                  <strong>{rejection.scope === "WHOLE_SPECIMEN" ? tr(locale, "Whole specimen", "العينة كاملة") : tr(locale, "Selected tests", "فحوصات محددة")} · {locale === "ar" ? rejection.reasonNameArSnapshot || rejection.reasonNameEnSnapshot : rejection.reasonNameEnSnapshot}</strong>
                  <small>{rejection.affectedLinks.map(link => link.orderItem.testCodeSnapshot).join(", ")} · {rejection.reasonDetails}</small>
                </div>)}
              </div>
            </details>}

            <details className="specimen-history">
              <summary>{tr(locale, "Chain of custody", "سلسلة الحيازة")} ({recentEvents.length} {tr(locale, "recent events", "أحداث حديثة")})</summary>
              <div className="summary-list">
                {recentEvents.map(event => <div key={event.id}>
                  <span>{<SystemDateText value={event.occurredAt.toISOString()} timeZone={event.branch?.timezone || specimen.order.orderingBranch.timezone} />} · {event.branch?.code || "—"} · {event.actor ? userName(event.actor) : tr(locale, "System", "النظام")}</span>
                  <strong>{eventLabel(event.eventType)}{event.fromStatus || event.toStatus ? ` · ${event.fromStatus ? statusLabel(locale, event.fromStatus) : tr(locale, "New", "جديد")} → ${event.toStatus ? statusLabel(locale, event.toStatus) : "—"}` : ""}</strong>
                </div>)}
              </div>
            </details>
          </section>;
        })
      }
    </div>
  </main>;
}
