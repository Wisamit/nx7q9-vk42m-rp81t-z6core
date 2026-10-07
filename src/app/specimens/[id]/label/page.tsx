import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { code128BBars, specimenLabelSize } from "@/lib/code128";
import { prisma } from "@/lib/db";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";
import { getUiLocale, tr } from "@/lib/ui-i18n";
import { SpecimenLabelPrintButton } from "@/components/specimen-label-print-button";

export const dynamic = "force-dynamic";

const dimensions = {
  "50x30": { width: 50, height: 30 },
  "50x25": { width: 50, height: 25 },
  "40x25": { width: 40, height: 25 },
} as const;

export default async function SpecimenLabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string }>;
}) {
  const session = await requirePermission("specimens.collect");
  const locale = getUiLocale(session.user.preferredLocale);
  const { id } = await params;
  const query = await searchParams;
  const labelSize = specimenLabelSize(query.size);
  const size = dimensions[labelSize];

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      specimenType: true,
      container: true,
      orderItems: { include: { orderItem: true } },
      order: { include: { patient: true, orderingBranch: true } },
      events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!specimen) notFound();

  const accessible = (specimen.currentBranchId && canAccessBranch(session, specimen.currentBranchId))
    || canAccessBranch(session, specimen.order.orderingBranchId);
  if (!accessible) notFound();

  const requirement = specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;
  const plannedWithoutFinalizedRequirements = specimen.status === "PLANNED" && !requirement;
  const encoded = code128BBars(specimen.barcode);
  if (!encoded) throw new Error("INVALID_SPECIMEN_BARCODE");

  const priorPrintCount = await prisma.auditEvent.count({
    where: {
      organizationId: session.user.organizationId,
      action: "SPECIMEN_LABEL_PRINTED",
      entityType: "Specimen",
      entityId: specimen.id,
    },
  });

  const patientPrimary = locale === "ar"
    ? specimen.order.patient.fullNameAr || specimen.order.patient.fullNameEn
    : specimen.order.patient.fullNameEn;
  const patientSecondary = specimen.order.patient.fullNameAr
    && specimen.order.patient.fullNameAr !== specimen.order.patient.fullNameEn
    ? (locale === "ar" ? specimen.order.patient.fullNameEn : specimen.order.patient.fullNameAr)
    : null;
  const specimenName = specimen.specimenType
    ? (locale === "ar" ? specimen.specimenType.nameAr || specimen.specimenType.nameEn : specimen.specimenType.nameEn)
    : tr(locale, "Unconfigured specimen", "عينة غير مهيأة");
  const containerName = specimen.container
    ? (locale === "ar" ? specimen.container.nameAr || specimen.container.nameEn : specimen.container.nameEn)
    : "—";
  const testCodes = specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(" · ");
  const dob = specimen.order.patient.dateOfBirth?.toISOString().slice(0, 10) || "—";

  return <main className="label-print-shell">
    <style>{`
      @page { size: ${size.width}mm ${size.height}mm; margin: 0; }
      .label-print-shell { min-height: 100vh; display: grid; align-content: start; justify-items: center; gap: 14px; padding: 24px; }
      .specimen-label-paper { box-sizing: border-box; width: ${size.width}mm; height: ${size.height}mm; padding: 1.4mm 1.8mm; background: white; color: black; border: 1px solid var(--fl-border); overflow: hidden; font-family: Arial, sans-serif; display: grid; grid-template-rows: auto auto auto 1fr; gap: .6mm; }
      .specimen-label-head { display: flex; justify-content: space-between; gap: 2mm; font-size: 2.4mm; line-height: 1.1; }
      .specimen-label-patient { font-size: 3.2mm; font-weight: 800; line-height: 1.05; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .specimen-label-secondary { font-size: 2.1mm; font-weight: 600; }
      .specimen-label-meta { display: grid; grid-template-columns: 1fr 1fr; gap: .3mm 1.5mm; font-size: 2.0mm; line-height: 1.1; }
      .specimen-label-barcode { align-self: end; min-height: 9mm; display: grid; gap: .3mm; }
      .specimen-label-barcode svg { width: 100%; height: 7.2mm; display: block; color: black; }
      .specimen-label-barcode strong { text-align: center; font-size: 2.3mm; letter-spacing: .15mm; line-height: 1; direction: ltr; }
      .specimen-label-tests { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .specimen-label-controls { width: min(680px, 100%); display: grid; gap: 10px; }
      .specimen-label-controls label { display: grid; gap: 6px; }
      .specimen-label-size-links { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .specimen-label-warning { width: min(680px, 100%); }
      @media print {
        body { background: white !important; }
        body * { visibility: hidden !important; }
        .specimen-label-paper, .specimen-label-paper * { visibility: visible !important; }
        .specimen-label-paper { position: absolute; inset: 0; border: 0; margin: 0; }
        .no-print { display: none !important; }
      }
    `}</style>

    <div className="no-print header-actions">
      <Link className="secondary-link" href="/specimens">{tr(locale, "Back to Specimens", "العودة للعينات")}</Link>
      <Link className="secondary-link" href="/specimens/scan">{tr(locale, "Scan Station", "محطة المسح")}</Link>
    </div>

    <div className="no-print specimen-label-size-links">
      {(["50x30","50x25","40x25"] as const).map(item =>
        <Link key={item} className={item === labelSize ? "primary-button" : "secondary-link"} href={`/specimens/${specimen.id}/label?size=${item}`}>{item}</Link>)}
    </div>

    {plannedWithoutFinalizedRequirements && <p className="no-print form-error specimen-label-warning">
      {tr(locale, "Printing is blocked until specimen requirements are finalized, so the label cannot be attached to an unverified tube plan.", "الطباعة مقفلة حتى يتم تثبيت متطلبات العينة، حتى لا يوضع الملصق على خطة أنبوب غير مثبتة.")}
    </p>}

    <section className="specimen-label-paper" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="specimen-label-head">
        <strong>{specimen.order.orderingBranch.code}</strong>
        <strong>{specimenName} · {containerName}</strong>
      </div>
      <div>
        <div className="specimen-label-patient">{patientPrimary}</div>
        {patientSecondary && <div className="specimen-label-secondary">{patientSecondary}</div>}
      </div>
      <div className="specimen-label-meta">
        <span>{tr(locale, "Patient", "المريض")}: <strong>{specimen.order.patient.patientNumber}</strong></span>
        <span>{tr(locale, "DOB", "الميلاد")}: <strong>{dob}</strong></span>
        <span>{tr(locale, "Order", "الطلب")}: <strong>{specimen.order.accessionNumber}</strong></span>
        <span>{tr(locale, "Req.", "المطلوب")}: <strong>{requirement?.requiredVolume ? `${requirement.requiredVolume} ${requirement.requiredVolumeUnit || ""}` : "—"}</strong></span>
        <span className="specimen-label-tests">{tr(locale, "Tests", "الفحوصات")}: <strong>{testCodes || "—"}</strong></span>
      </div>
      <div className="specimen-label-barcode" dir="ltr">
        <svg viewBox={`0 0 ${encoded.widthModules} 40`} role="img" aria-label={specimen.barcode} preserveAspectRatio="none">
          {encoded.bars.map((bar, index) => <rect key={index} x={bar.x} y="0" width={bar.width} height="40" fill="currentColor" />)}
        </svg>
        <strong>{specimen.barcode}</strong>
      </div>
    </section>

    <SpecimenLabelPrintButton
      specimenId={specimen.id}
      locale={locale}
      isReprint={priorPrintCount > 0}
      labelSize={labelSize}
      disabled={plannedWithoutFinalizedRequirements}
    />
    {priorPrintCount > 0 && <p className="no-print muted">{tr(locale, "Previous recorded print jobs", "عمليات الطباعة المسجلة سابقًا")}: {priorPrintCount}</p>}
  </main>;
}
