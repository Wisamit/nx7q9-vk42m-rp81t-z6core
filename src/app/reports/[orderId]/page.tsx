import { SystemDateText } from "@/components/system-date-text";
import { Fragment } from "react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { authorizedDepartmentIds, canAccessBranch, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canonicalReportOrigin } from "@/lib/report-origin";
import { compareCurrentReportWithPrevious, type ReportComparisonEvidence } from "@/lib/report-cumulative";
import { resolvePatientLineage } from "@/lib/patient-identity-lineage";
import { ReportCumulativeComparison } from "@/components/report-cumulative-comparison";
import { PrintReportButton } from "@/components/print-report-button";
import { StaffReportHandover } from "@/components/staff-report-handover";
import { isStaffHandoverEvent } from "@/lib/report-handover";
import { ReportPdfButton } from "@/components/report-pdf-button";
import { ReportOutboundDelivery } from "@/components/report-outbound-delivery";
import { maskedDestination, resolveVerifiedPortalDestination, type ReportOutboundChannel } from "@/lib/report-outbound";
import {
  effectiveReportLocale,
  localizedReportText,
  reportShowsArabic,
  reportShowsEnglish,
  secondaryReportText,
} from "@/lib/report-language";
import { getUiLocale, priorityLabel, sexLabel, statusLabel, tr, type UiLocale } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

type ReportValue = {
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  reportDisplayOrder: number | null;
  reportSectionCode: string | null;
  reportSectionNameEn: string | null;
  reportSectionNameAr: string | null;
  reportSectionOrder: number | null;
  displayValue: string;
  unit: string | null;
  flag: string;
  isCritical: boolean;
  comments: string | null;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceTextEn: string | null;
  referenceTextAr: string | null;
};

type MicrobiologySnapshot = {
  cultureStatus: string;
  preliminaryComment: string | null;
  finalComment: string | null;
  observations: Array<{ type: string; text: string; observedAt: string }>;
  isolates: Array<{
    sequenceNumber: number;
    organism: { code: string; nameEn: string; nameAr: string | null };
    quantityText: string | null;
    colonyNotes: string | null;
    susceptibilityTests: Array<{
      method: string | null;
      comments: string | null;
      testedAt: string;
      results: Array<{
        antibioticCode: string;
        antibioticNameEn: string;
        antibioticNameAr: string | null;
        interpretation: string;
        micValue: string | null;
        micUnit: string | null;
        zoneDiameterMm: string | null;
        breakpointSnapshot: string | null;
      }>;
    }>;
  }>;
};

type ReportResult = {
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  resultVersion: number;
  analyzer: { id: string | null; code: string; name: string | null } | null;
  performingBranch: { code: string; nameEn: string; nameAr: string | null };
  specimen: { barcode: string; collectedAt: string | null; receivedAt: string | null } | null;
  values: ReportValue[];
  comments: string | null;
  microbiology: MicrobiologySnapshot | null;
  verifiedBy: { nameEn: string; nameAr: string | null } | null;
  verifiedAt: string | null;
  releasedBy: { nameEn: string; nameAr: string | null } | null;
  releasedAt: string | null;
  amendedFromResultId: string | null;
  amendmentReason: string | null;
};

type ReportTemplateSnapshot = {
  templateId: string;
  templateCode: string;
  templateNameEn: string;
  templateNameAr: string | null;
  templateVersion: number;
  configuration: {
    languageMode: "BILINGUAL" | "ENGLISH" | "ARABIC";
    logoUrl: string | null;
    headerEn: string | null;
    headerAr: string | null;
    footerEn: string | null;
    footerAr: string | null;
    watermark: string | null;
    showSignature: boolean;
    showQr: boolean;
    showPageNumbers: boolean;
    columns: Array<"TEST" | "RESULT" | "FLAG" | "UNIT" | "REFERENCE">;
  };
};

type Snapshot = {
  organization: { nameEn: string; nameAr: string | null; legalName: string | null };
  branch: {
    code: string;
    nameEn: string;
    nameAr: string | null;
    phone: string | null;
    email: string | null;
    addressEn: string | null;
    addressAr: string | null;
  };
  patient: {
    patientNumber: string;
    fullNameEn: string;
    fullNameAr: string | null;
    dateOfBirth: string | null;
    sexAtBirth: string;
  };
  order: {
    accessionNumber: string;
    priority: string;
    orderedAt: string;
    diagnosis: string | null;
    clinicalNotes: string | null;
  };
  reportInterpretation?: { id: string; revisionNumber: number; textEn: string;
    textAr: string; approvedAt: string | null; approvedByUserId: string | null } | null;
  referrer: { nameEn: string; nameAr: string | null } | null;
  results: ReportResult[];
  completeness: { releasedItemCount: number; totalItemCount: number; final: boolean };
};

function referenceText(value: ReportValue, locale: UiLocale) {
  const localizedText = locale === "ar" ? value.referenceTextAr || value.referenceTextEn : value.referenceTextEn;
  if (localizedText) return localizedText;
  if (value.referenceLow !== null || value.referenceHigh !== null) {
    return `${value.referenceLow ?? "—"} – ${value.referenceHigh ?? "—"}`;
  }
  return "—";
}

export default async function DiagnosticReportPage({ params }: { params: Promise<{ orderId: string }> }) {
  const session = await requirePermission("reports.view");
  const { orderId } = await params;
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);

  const report = await prisma.diagnosticReport.findFirst({
    where: { orderId, organizationId: session.user.organizationId },
    include: {
      order: {
        include: {
          orderingBranch: true,
          patient: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
          referrer: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
          client: { include: { portalAccount: {
                include: { contactVerifications: { where: { revokedAt: null }, orderBy: { verifiedAt: "desc" } } },
              } } },
        },
      },
      versions: {
        include: { issuedBy: true, branch: true, deliveries: { include: { performedBy: true }, orderBy: { occurredAt: "desc" } } },
        orderBy: { version: "desc" },
      },
    },
  });

  if (!report || !canAccessBranch(session, report.order.orderingBranchId)) notFound();

  const corporateCanViewReports = report.order.clientId
    ? Boolean(await prisma.corporatePortalPatientAccess.findFirst({
        where: {
          clientId: report.order.clientId,
          patientId: report.order.patientId,
          canViewReports: true,
          status: "ACTIVE",
          effectiveFrom: { lte: new Date() },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
        },
        select: { id: true },
      }))
    : false;

  const latest = report.versions[0];
  if (!latest) {
    return <main className="catalog-shell">
      <header className="page-header">
        <div><p className="eyebrow">{tr(locale, "Diagnostic Report", "التقرير التشخيصي")}</p><h1>{tr(locale, "No Released Report Yet", "لا يوجد تقرير صادر بعد")}</h1></div>
        <Link className="secondary-link" href={`/reports/${orderId}/interpretation`}>{tr(locale, "Interpretive comments", "التعليقات التفسيرية")}</Link>
        <Link className="secondary-link" href={`/orders/${orderId}`}>{tr(locale, "Back to Order", "العودة للطلب")}</Link>
      </header>
      <section className="detail-card"><p className="muted">{tr(locale, "A report version is created when a verified result is released.", "يتم إنشاء إصدار تقرير عند إصدار نتيجة تم التحقق منها.")}</p></section>
    </main>;
  }

  // Companion history is staff-only and never modifies a released report,
  // PDF, template or clinical reference snapshot. A department-restricted user
  // cannot infer another department's historic observations from this view.
  const activeBranchIds = session.user.branchScopes
    .filter(scope => scope.branch.status === "ACTIVE")
    .map(scope => scope.branchId);
  const currentReportDeliverable = latest.version === report.currentVersion &&
    ["PARTIAL", "FINAL", "AMENDED"].includes(latest.status);
  const comparisonEligible = latest.version === report.currentVersion
    && ["PARTIAL", "FINAL", "AMENDED"].includes(latest.status)
    && authorizedDepartmentIds(session).length === 0;
  const lineage = comparisonEligible
    ? await prisma.$transaction(
        tx => resolvePatientLineage(tx, session.user.organizationId, report.order.patientId),
        { isolationLevel: "RepeatableRead" },
      )
    : null;
  const linkedPatientIds = lineage?.patientIds || [];

  // Bound the previous-order scan, and disclose explicitly when older records
  // remain. Never equate a bounded search with a complete clinical history.
  const inspectedCandidates = comparisonEligible && linkedPatientIds.length > 0
    ? await prisma.diagnosticReport.findMany({
        where: {
          organizationId: session.user.organizationId,
          id: { not: report.id },
          order: {
            organizationId: session.user.organizationId,
            patientId: { in: linkedPatientIds },
            orderingBranchId: { in: activeBranchIds },
            orderedAt: { lt: report.order.orderedAt },
          },
        },
        select: {
          currentVersion: true,
          order: { select: { id: true, patientId: true, accessionNumber: true, orderedAt: true } },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              version: true,
              status: true,
              issuedAt: true,
              contentSnapshot: true,
              resultVersionSnapshot: true,
            },
          },
        },
        orderBy: { order: { orderedAt: "desc" } },
        take: 101,
      })
    : [];
  const moreComparisonHistory = inspectedCandidates.length > 100;
  const comparisonHistory = inspectedCandidates.slice(0, 100);
  const currentComparisonEvidence: ReportComparisonEvidence = {
    currentVersion: report.currentVersion,
    order: {
      id: report.order.id,
      patientId: report.order.patientId,
      accessionNumber: report.order.accessionNumber,
      orderedAt: report.order.orderedAt,
    },
    versions: [{
      version: latest.version,
      status: latest.status,
      issuedAt: latest.issuedAt,
      contentSnapshot: latest.contentSnapshot,
      resultVersionSnapshot: latest.resultVersionSnapshot,
    }],
  };
  const comparisonRows = comparisonEligible
    ? compareCurrentReportWithPrevious(currentComparisonEvidence, comparisonHistory, activeBranchIds)
    : [];

  const snapshot = latest.contentSnapshot as unknown as Snapshot;
  const templateSnapshot = latest.templateSnapshot as unknown as ReportTemplateSnapshot | null;
  const templateConfig = templateSnapshot?.configuration || {
    languageMode: "BILINGUAL" as const,
    logoUrl: null,
    headerEn: null,
    headerAr: null,
    footerEn: null,
    footerAr: null,
    watermark: null,
    showSignature: true,
    showQr: true,
    showPageNumbers: true,
    columns: ["TEST","RESULT","FLAG","UNIT","REFERENCE"] as Array<"TEST"|"RESULT"|"FLAG"|"UNIT"|"REFERENCE">,
  };
  const reportColumns = new Set(templateConfig.columns);
  const reportColumnCount = Math.max(1, templateConfig.columns.length);
  const reportLocale = effectiveReportLocale(templateConfig.languageMode, locale);
  const showEnglish = reportShowsEnglish(templateConfig.languageMode);
  const showArabic = reportShowsArabic(templateConfig.languageMode);
  const reportTr = <T,>(en: T, ar: T) => tr(reportLocale, en, ar);
  const baseUrl = canonicalReportOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NODE_ENV === "production",
  );
  const verificationUrl = baseUrl ? `${baseUrl}/verify/report/${latest.verificationToken}` : "";
  const qrDataUrl = verificationUrl ? await QRCode.toDataURL(verificationUrl, { width: 132, margin: 1 }) : "";

  const outboundChannels: ReportOutboundChannel[] = ["EMAIL", "SMS", "WHATSAPP"];
  const outboundRecipients = [
    {
      type: "PATIENT" as const,
      label: `${tr(locale, "Patient", "المريض")} — ${locale === "ar" ? report.order.patient.fullNameAr || report.order.patient.fullNameEn : report.order.patient.fullNameEn}`,
      account: report.order.patient.portalAccount,
    },
    ...(report.order.referrer ? [{
      type: "REFERRER" as const,
      label: `${tr(locale, "Referrer", "المحيل")} — ${locale === "ar" ? report.order.referrer.nameAr || report.order.referrer.nameEn : report.order.referrer.nameEn}`,
      account: report.order.referrer.portalAccount,
    }] : []),
    ...(report.order.client && corporateCanViewReports ? [{
      type: "CLIENT" as const,
      label: `${tr(locale, "Client", "العميل")} — ${locale === "ar" ? report.order.client.nameAr || report.order.client.nameEn : report.order.client.nameEn}`,
      account: report.order.client.portalAccount,
    }] : []),
  ].flatMap(recipient => {
    const account = recipient.account;
    if (!account || account.status !== "ACTIVE") return [];

    const channels = outboundChannels.flatMap(channel => {
      const resolved = resolveVerifiedPortalDestination(account, channel);
      return resolved.ok ? [{ channel, destinationMasked: maskedDestination(channel, resolved.destination) }] : [];
    });

    const verificationCandidates = [
      ...(account.email && !resolveVerifiedPortalDestination(account, "EMAIL").ok
        ? [{ channel: "EMAIL" as const, destinationMasked: maskedDestination("EMAIL", account.email) }]
        : []),
      ...(account.phone && !resolveVerifiedPortalDestination(account, "SMS").ok
        ? [{ channel: "PHONE" as const, destinationMasked: maskedDestination("SMS", account.phone) }]
        : []),
    ];

    if (channels.length === 0 && verificationCandidates.length === 0) return [];
    return [{
      type: recipient.type,
      label: recipient.label,
      portalAccountId: account.id,
      channels,
      verificationCandidates,
    }];
  });

  return <main className="report-shell">
    <div className="report-toolbar no-print">
      <div>
        <p className="eyebrow">{tr(locale, "Diagnostic Report", "التقرير التشخيصي")}</p>
        <h1>{snapshot.order.accessionNumber}</h1>
        <p className="muted">{tr(locale, "Version", "الإصدار")} {latest.version} · {statusLabel(locale, latest.status)}{templateSnapshot ? ` · ${tr(locale, "Template", "القالب")} ${templateSnapshot.templateCode} v${templateSnapshot.templateVersion}` : ""}</p>
      </div>
      <div className="header-actions">
        {permissions.has("reports.deliver") && currentReportDeliverable && <>
          <ReportPdfButton
            reportVersionId={latest.id}
            accessionNumber={snapshot.order.accessionNumber}
            reportVersion={latest.version}
            showPageNumbers={templateConfig.showPageNumbers}
            locale={locale}
          />
          <PrintReportButton reportVersionId={latest.id} canRecordDelivery locale={locale} />
        </>}
        <Link className="secondary-link" href={`/orders/${orderId}`}>{tr(locale, "Back to Order", "العودة للطلب")}</Link>
      </div>
    </div>

    <article id="diagnostic-report-version" className="diagnostic-report professional-report" dir={reportLocale === "ar" ? "rtl" : "ltr"}>
      {latest.status === "RETRACTED" && <div role="alert" className="report-amended-banner">
        <strong>{reportTr("WITHDRAWN REPORT — NOT VALID FOR CLINICAL USE", "تقرير مسحوب — غير صالح للاستخدام السريري")}</strong>
      </div>}
      {templateConfig.watermark && <div className="report-watermark" aria-hidden="true">{templateConfig.watermark}</div>}
      <header className="report-header">
        <div className="report-brand-block">
          {templateConfig.logoUrl && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="report-template-logo" src={templateConfig.logoUrl} alt={tr(locale, "Laboratory logo", "شعار المختبر")} />
          </>}
          {showEnglish && templateConfig.headerEn && <p className="report-template-header" dir="ltr">{templateConfig.headerEn}</p>}
          {showArabic && templateConfig.headerAr && <p className="report-template-header" dir="rtl">{templateConfig.headerAr}</p>}
          {showEnglish && <h1 dir="ltr">{snapshot.organization.nameEn}</h1>}
          {showArabic && snapshot.organization.nameAr && <h2 dir="rtl">{snapshot.organization.nameAr}</h2>}
          <p>{localizedReportText(templateConfig.languageMode, locale, { en: snapshot.branch.nameEn, ar: snapshot.branch.nameAr })}
            {secondaryReportText(templateConfig.languageMode, locale, { en: snapshot.branch.nameEn, ar: snapshot.branch.nameAr }) ? ` · ${secondaryReportText(templateConfig.languageMode, locale, { en: snapshot.branch.nameEn, ar: snapshot.branch.nameAr })}` : ""}
          </p>
          <p>{localizedReportText(templateConfig.languageMode, locale, { en: snapshot.branch.addressEn, ar: snapshot.branch.addressAr }) || ""}</p>
          <p>{[snapshot.branch.phone, snapshot.branch.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="report-version-stamp">
          {templateConfig.showQr && qrDataUrl && <Image src={qrDataUrl} alt={tr(locale, "Report verification QR code", "رمز QR للتحقق من التقرير")} width={104} height={104} unoptimized />}
          <strong className={"status-badge status-" + latest.status.toLowerCase().replaceAll("_","-")}>{statusLabel(reportLocale, latest.status)}</strong>
          <span>{reportTr("Report version", "إصدار التقرير")} {latest.version}</span>
          <span>{reportTr("Issued", "صدر")} {latest.issuedAt.toISOString().replace("T"," ").slice(0,19)}</span>
          {templateConfig.showQr && <span>{reportTr("Scan QR to verify", "امسح QR للتحقق")}</span>}
        </div>
      </header>

      {latest.status === "AMENDED" && <div className="report-amended-banner">
        <strong>{reportTr("AMENDED REPORT", "تقرير معدل")}</strong>
        <span>{latest.amendmentReason || reportTr("A released result was amended.", "تم تعديل نتيجة صادرة.")}</span>
      </div>}

      <section className="report-patient-grid">
        <div><span>{reportTr("Patient", "المريض")}</span><strong>{localizedReportText(templateConfig.languageMode, locale, { en: snapshot.patient.fullNameEn, ar: snapshot.patient.fullNameAr })}</strong>{secondaryReportText(templateConfig.languageMode, locale, { en: snapshot.patient.fullNameEn, ar: snapshot.patient.fullNameAr }) && <small>{secondaryReportText(templateConfig.languageMode, locale, { en: snapshot.patient.fullNameEn, ar: snapshot.patient.fullNameAr })}</small>}</div>
        <div><span>{reportTr("Patient No.", "رقم المريض")}</span><strong>{snapshot.patient.patientNumber}</strong></div>
        <div><span>{reportTr("Date of Birth", "تاريخ الميلاد")}</span><strong>{snapshot.patient.dateOfBirth || "—"}</strong></div>
        <div><span>{reportTr("Sex", "الجنس")}</span><strong>{sexLabel(reportLocale, snapshot.patient.sexAtBirth)}</strong></div>
        <div><span>{reportTr("Accession", "رقم الطلب")}</span><strong>{snapshot.order.accessionNumber}</strong></div>
        <div><span>{reportTr("Priority", "الأولوية")}</span><strong>{priorityLabel(reportLocale, snapshot.order.priority)}</strong></div>
        <div><span>{reportTr("Ordered", "تاريخ الطلب")}</span><strong>{snapshot.order.orderedAt.replace("T"," ").slice(0,19)}</strong></div>
        <div><span>{reportTr("Referrer", "المحيل")}</span><strong>{snapshot.referrer ? localizedReportText(templateConfig.languageMode, locale, { en: snapshot.referrer.nameEn, ar: snapshot.referrer.nameAr }) : "—"}</strong></div>
      </section>

      <section className="report-results">
        <table>
          <thead>
            <tr>
              {reportColumns.has("TEST") && <th>{reportTr("Test / Component", "الفحص / المكوّن")}</th>}
              {reportColumns.has("RESULT") && <th>{reportTr("Result", "النتيجة")}</th>}
              {reportColumns.has("FLAG") && <th>{reportTr("Flag", "العلامة")}</th>}
              {reportColumns.has("UNIT") && <th>{reportTr("Unit", "الوحدة")}</th>}
              {reportColumns.has("REFERENCE") && <th>{reportTr("Reference Range", "المجال المرجعي")}</th>}
            </tr>
          </thead>
          <tbody>
            {snapshot.results.map((result) => [
              <tr className="report-test-heading" key={`${result.testCode}-head`}>
                <td colSpan={reportColumnCount}>
                  <strong>{result.testCode} — {localizedReportText(templateConfig.languageMode, locale, { en: result.testNameEn, ar: result.testNameAr })}</strong>
                  {secondaryReportText(templateConfig.languageMode, locale, { en: result.testNameEn, ar: result.testNameAr }) && <span> · {secondaryReportText(templateConfig.languageMode, locale, { en: result.testNameEn, ar: result.testNameAr })}</span>}
                  <small> · {localizedReportText(templateConfig.languageMode, locale, { en: result.performingBranch.nameEn, ar: result.performingBranch.nameAr })} · {reportTr("Result", "النتيجة")} v{result.resultVersion}{result.analyzer ? ` · ${reportTr("Analyzer", "جهاز التحليل")}: ${result.analyzer.code}${result.analyzer.name ? " — " + result.analyzer.name : ""}` : ""}</small>
                </td>
              </tr>,
              ...result.values.map((value, valueIndex) => {
                const previous = valueIndex > 0 ? result.values[valueIndex - 1] : null;
                const showSectionHeading = Boolean(
                  value.reportSectionCode
                  && value.reportSectionCode !== previous?.reportSectionCode
                  && (value.reportSectionNameEn || value.reportSectionNameAr),
                );
                return <Fragment key={`${result.testCode}-${value.componentCode}`}>
                  {showSectionHeading && <tr className="report-section-heading">
                    <td colSpan={reportColumnCount}>
                      <strong>{localizedReportText(templateConfig.languageMode, locale, { en: value.reportSectionNameEn || value.reportSectionCode || "", ar: value.reportSectionNameAr })}</strong>
                      {secondaryReportText(templateConfig.languageMode, locale, { en: value.reportSectionNameEn || value.reportSectionCode || "", ar: value.reportSectionNameAr }) && <span> · {secondaryReportText(templateConfig.languageMode, locale, { en: value.reportSectionNameEn || value.reportSectionCode || "", ar: value.reportSectionNameAr })}</span>}
                    </td>
                  </tr>}
                  <tr className={value.isCritical ? "report-critical-row" : ""}>
                    {reportColumns.has("TEST") && <td>
                      <strong>{localizedReportText(templateConfig.languageMode, locale, { en: value.componentNameEn, ar: value.componentNameAr })}</strong>
                      {secondaryReportText(templateConfig.languageMode, locale, { en: value.componentNameEn, ar: value.componentNameAr }) && <small>{secondaryReportText(templateConfig.languageMode, locale, { en: value.componentNameEn, ar: value.componentNameAr })}</small>}
                    </td>}
                    {reportColumns.has("RESULT") && <td><strong>{value.displayValue}</strong></td>}
                    {reportColumns.has("FLAG") && <td>{value.flag === "UNKNOWN" ? "—" : <span className={"result-flag-badge flag-" + value.flag.toLowerCase().replaceAll("_","-")}>{value.flag}</span>}</td>}
                    {reportColumns.has("UNIT") && <td>{value.unit || "—"}</td>}
                    {reportColumns.has("REFERENCE") && <td>{referenceText(value, reportLocale)}</td>}
                  </tr>
                  {value.comments && <tr className="report-component-comment"><td colSpan={reportColumnCount}><strong>{reportTr("Component comment", "تعليق المكوّن")}:</strong> {value.comments}</td></tr>}
                </Fragment>;
              }),
              result.microbiology ? <tr key={`${result.testCode}-microbiology`}>
                <td colSpan={reportColumnCount}>
                  <div className="report-notes">
                    <p><strong>{reportTr("Culture status", "حالة الزرع")}:</strong> {result.microbiology.cultureStatus.replaceAll("_", " ")}</p>
                    {result.microbiology.finalComment && <p><strong>{reportTr("Final interpretation", "التفسير النهائي")}:</strong> {result.microbiology.finalComment}</p>}
                    {result.microbiology.observations.length > 0 && <div>
                      <strong>{reportTr("Culture observations", "ملاحظات الزرع")}</strong>
                      <ul>{result.microbiology.observations.map((observation, index) =>
                        <li key={index}>{observation.type.replaceAll("_", " ")}: {observation.text}</li>
                      )}</ul>
                    </div>}
                    {result.microbiology.isolates.map(isolate => <div key={isolate.sequenceNumber} className="detail-section">
                      <p><strong>{reportTr("Isolate", "العزلة")} #{isolate.sequenceNumber}: {isolate.organism.code} — {localizedReportText(templateConfig.languageMode, locale, { en: isolate.organism.nameEn, ar: isolate.organism.nameAr })}</strong>
                        {isolate.quantityText ? ` · ${isolate.quantityText}` : ""}</p>
                      {isolate.colonyNotes && <p>{isolate.colonyNotes}</p>}
                      {isolate.susceptibilityTests.map((panel, panelIndex) => <div key={panelIndex}>
                        <p><strong>{reportTr("Susceptibility", "الحساسية")}:</strong> {panel.method || reportTr("Method not specified", "الطريقة غير محددة")}</p>
                        <table>
                          <thead><tr><th>{reportTr("Antibiotic", "المضاد الحيوي")}</th><th>S/I/R</th><th>MIC</th><th>{reportTr("Zone", "القطر")}</th><th>{reportTr("Breakpoint", "حد التفسير")}</th></tr></thead>
                          <tbody>{panel.results.map(item => <tr key={item.antibioticCode}>
                            <td>{item.antibioticCode} — {localizedReportText(templateConfig.languageMode, locale, { en: item.antibioticNameEn, ar: item.antibioticNameAr })}</td>
                            <td>{item.interpretation}</td>
                            <td>{item.micValue || "—"}{item.micUnit ? " " + item.micUnit : ""}</td>
                            <td>{item.zoneDiameterMm ? item.zoneDiameterMm + " mm" : "—"}</td>
                            <td>{item.breakpointSnapshot || "—"}</td>
                          </tr>)}</tbody>
                        </table>
                        {panel.comments && <p>{panel.comments}</p>}
                      </div>)}
                    </div>)}
                  </div>
                </td>
              </tr> : null,
              result.comments && !result.microbiology ? <tr key={`${result.testCode}-comment`}><td colSpan={reportColumnCount}><strong>{reportTr("Comment", "تعليق")}:</strong> {result.comments}</td></tr> : null,
              <tr className="report-result-meta" key={`${result.testCode}-meta`}>
                <td colSpan={reportColumnCount}>
                  {reportTr("Specimen", "العينة")}: {result.specimen?.barcode || "—"} · {reportTr("Collected", "جُمعت")}: {result.specimen?.collectedAt?.replace("T"," ").slice(0,19) || "—"} ·
                  {templateConfig.showSignature ? <>{reportTr("Verified", "تم التحقق")}: {result.verifiedBy ? localizedReportText(templateConfig.languageMode, locale, { en: result.verifiedBy.nameEn, ar: result.verifiedBy.nameAr }) : "—"} · {reportTr("Released", "تم الإصدار")}: {result.releasedBy ? localizedReportText(templateConfig.languageMode, locale, { en: result.releasedBy.nameEn, ar: result.releasedBy.nameAr }) : "—"}</> : <>{reportTr("Released", "تم الإصدار")}: {result.releasedAt?.replace("T"," ").slice(0,19) || "—"}</>}
                </td>
              </tr>,
            ])}
          </tbody>
        </table>
      </section>

      {(snapshot.order.diagnosis || snapshot.order.clinicalNotes) && <section className="report-notes">
        {snapshot.order.diagnosis && <p><strong>{reportTr("Clinical indication", "الدلالة السريرية")}:</strong> {snapshot.order.diagnosis}</p>}
        {snapshot.order.clinicalNotes && <p><strong>{reportTr("Clinical notes", "الملاحظات السريرية")}:</strong> {snapshot.order.clinicalNotes}</p>}
      </section>}

      {snapshot.reportInterpretation && <section className="report-notes">
        <strong>{reportTr("Approved report interpretation", "التفسير السريري المعتمد")} · v{snapshot.reportInterpretation.revisionNumber}</strong>
        {showEnglish && <p dir="ltr" style={{ whiteSpace: "pre-wrap" }}>{snapshot.reportInterpretation.textEn}</p>}
        {showArabic && <p dir="rtl" style={{ whiteSpace: "pre-wrap" }}>{snapshot.reportInterpretation.textAr}</p>}
      </section>}

      {(templateConfig.footerEn || templateConfig.footerAr) && <section className="report-template-footer">
        {showEnglish && templateConfig.footerEn && <p dir="ltr">{templateConfig.footerEn}</p>}
        {showArabic && templateConfig.footerAr && <p dir="rtl">{templateConfig.footerAr}</p>}
      </section>}
      <footer className="report-footer">
        <div>
          <strong>{snapshot.completeness.final ? reportTr("Final report", "تقرير نهائي") : reportTr("Partial report", "تقرير جزئي")}</strong>
          <span>{snapshot.completeness.releasedItemCount}/{snapshot.completeness.totalItemCount} {reportTr("order item(s) released", "عنصر طلب تم إصداره")}</span>
        </div>
        <div>
          <span>{reportTr("Issued by", "صدر بواسطة")}: {localizedReportText(templateConfig.languageMode, locale, { en: latest.issuedBy.displayNameEn, ar: latest.issuedBy.displayNameAr })}</span>
          <span>{reportTr("Verification token", "رمز التحقق")}: {latest.verificationToken.slice(0,16)}…</span>
          {verificationUrl && <span className="verification-url">{verificationUrl}</span>}
        </div>
      </footer>
    </article>

    {comparisonEligible && <ReportCumulativeComparison
      rows={comparisonRows}
      locale={locale}
      examinedReports={comparisonHistory.length}
      moreReportsAvailable={moreComparisonHistory}
    />}

    {latest.status === "RETRACTED" && <section className="detail-card no-print" role="alert">
      <strong>{tr(locale, "Withdrawn report — no current comparison permitted", "تقرير مسحوب — لا يُسمح بعرض مقارنة حالية")}</strong>
      <p>{tr(locale,
        "Do not use this historical report to interpret current results.",
        "لا تستخدم هذا التقرير التاريخي لتفسير النتائج الحالية.",
      )}</p>
    </section>}

    {permissions.has("reports.deliver") && currentReportDeliverable && <ReportOutboundDelivery
      reportVersionId={latest.id}
      recipients={outboundRecipients}
      locale={locale}
      canVerifyContacts={permissions.has("portal_accounts.manage")}
    />}

    {permissions.has("reports.deliver") && latest.version===report.currentVersion &&
      ["FINAL","AMENDED"].includes(latest.status) &&
      <StaffReportHandover reportVersionId={latest.id} locale={locale} />}

    {latest.deliveries.length > 0 && <section className="table-card report-history no-print">
      <div className="table-toolbar"><h2>{tr(locale, "Delivery History", "سجل التسليم")}</h2><span>{latest.deliveries.length} {tr(locale, "event(s)", "حدث")}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{tr(locale, "Time", "الوقت")}</th><th>{tr(locale, "Channel", "القناة")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Recipient", "المستلم")}</th><th>{tr(locale, "User", "المستخدم")}</th></tr></thead><tbody>{latest.deliveries.map(event => <tr key={event.id}><td>{<SystemDateText value={event.occurredAt.toISOString()} />}</td><td>{isStaffHandoverEvent(event.details)
    ? tr(locale, "IN-PERSON / STAFF ATTESTED", "تسليم حضوري / إقرار موظف") : event.channel}</td><td>{isStaffHandoverEvent(event.details)
    ? tr(locale, "STAFF ATTESTATION RECORDED (not independently acknowledged)",
      "إقرار موظف مسجل (دون تأكيد مستقل من المريض)") : event.status}</td><td>{event.recipient && ["EMAIL","SMS","WHATSAPP"].includes(event.channel)
  ? maskedDestination(event.channel as ReportOutboundChannel, event.recipient)
  : event.recipient || "—"}</td><td>{event.performedBy?.displayNameEn || tr(locale, "System", "النظام")}</td></tr>)}</tbody></table></div>
    </section>}

    <section className="table-card report-history no-print">
      <div className="table-toolbar"><h2>{tr(locale, "Report Version History", "سجل إصدارات التقرير")}</h2><span>{report.versions.length} {tr(locale, "version(s)", "إصدار")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Version", "الإصدار")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Template", "القالب")}</th><th>{tr(locale, "Issued", "الإصدار")}</th><th>{tr(locale, "Issued by", "صدر بواسطة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Amendment reason", "سبب التعديل")}</th></tr></thead>
          <tbody>{report.versions.map(version => <tr key={version.id}>
            <td><strong>{version.version}</strong></td>
            <td>{statusLabel(locale, version.status)}</td>
            <td>{version.reportTemplateVersionId ? tr(locale, "Versioned template", "قالب بإصدار محفوظ") : tr(locale, "Legacy/default layout", "تخطيط قديم / افتراضي")}</td>
            <td>{<SystemDateText value={version.issuedAt.toISOString()} timeZone={version.branch.timezone} />}</td>
            <td>{version.issuedBy.displayNameEn}</td>
            <td>{version.branch.nameEn}</td>
            <td>{version.amendmentReason || "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
