import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { canAccessBranch, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PrintReportButton } from "@/components/print-report-button";
import { getUiLocale, priorityLabel, sexLabel, statusLabel, tr, type UiLocale } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

type ReportValue = {
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  displayValue: string;
  unit: string | null;
  flag: string;
  isCritical: boolean;
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
      order: { include: { orderingBranch: true } },
      versions: {
        include: { issuedBy: true, branch: true, deliveries: { include: { performedBy: true }, orderBy: { occurredAt: "desc" } } },
        orderBy: { version: "desc" },
      },
    },
  });

  if (!report || !canAccessBranch(session, report.order.orderingBranchId)) notFound();

  const latest = report.versions[0];
  if (!latest) {
    return <main className="catalog-shell">
      <header className="page-header">
        <div><p className="eyebrow">{tr(locale, "Diagnostic Report", "التقرير التشخيصي")}</p><h1>{tr(locale, "No Released Report Yet", "لا يوجد تقرير صادر بعد")}</h1></div>
        <Link className="secondary-link" href={`/orders/${orderId}`}>{tr(locale, "Back to Order", "العودة للطلب")}</Link>
      </header>
      <section className="detail-card"><p className="muted">{tr(locale, "A report version is created when a verified result is released.", "يتم إنشاء إصدار تقرير عند إصدار نتيجة تم التحقق منها.")}</p></section>
    </main>;
  }

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
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  const protocol = headerStore.get("x-forwarded-proto") || "https";
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const baseUrl = configuredBaseUrl || (host ? protocol + "://" + host : "");
  const verificationUrl = baseUrl ? `${baseUrl}/verify/report/${latest.verificationToken}` : "";
  const qrDataUrl = verificationUrl ? await QRCode.toDataURL(verificationUrl, { width: 132, margin: 1 }) : "";

  return <main className="report-shell">
    <div className="report-toolbar no-print">
      <div>
        <p className="eyebrow">{tr(locale, "Diagnostic Report", "التقرير التشخيصي")}</p>
        <h1>{snapshot.order.accessionNumber}</h1>
        <p className="muted">{tr(locale, "Version", "الإصدار")} {latest.version} · {statusLabel(locale, latest.status)}{templateSnapshot ? ` · ${tr(locale, "Template", "القالب")} ${templateSnapshot.templateCode} v${templateSnapshot.templateVersion}` : ""}</p>
      </div>
      <div className="header-actions">
        {permissions.has("reports.deliver") && <PrintReportButton reportVersionId={latest.id} canRecordDelivery />}
        <Link className="secondary-link" href={`/orders/${orderId}`}>{tr(locale, "Back to Order", "العودة للطلب")}</Link>
      </div>
    </div>

    <article className="diagnostic-report professional-report">
      {templateConfig.watermark && <div className="report-watermark" aria-hidden="true">{templateConfig.watermark}</div>}
      <header className="report-header">
        <div className="report-brand-block">
          {templateConfig.logoUrl && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="report-template-logo" src={templateConfig.logoUrl} alt={tr(locale, "Laboratory logo", "شعار المختبر")} />
          </>}
          {templateConfig.headerEn && <p className="report-template-header">{templateConfig.headerEn}</p>}
          {templateConfig.headerAr && <p className="report-template-header" dir="rtl">{templateConfig.headerAr}</p>}
          <h1>{snapshot.organization.nameEn}</h1>
          {snapshot.organization.nameAr && <h2 dir="rtl">{snapshot.organization.nameAr}</h2>}
          <p>{snapshot.branch.nameEn}{snapshot.branch.nameAr ? ` · ${snapshot.branch.nameAr}` : ""}</p>
          <p>{snapshot.branch.addressEn || ""}</p>
          <p>{[snapshot.branch.phone, snapshot.branch.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="report-version-stamp">
          {templateConfig.showQr && qrDataUrl && <Image src={qrDataUrl} alt={tr(locale, "Report verification QR code", "رمز QR للتحقق من التقرير")} width={104} height={104} unoptimized />}
          <strong className={"status-badge status-" + latest.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, latest.status)}</strong>
          <span>{tr(locale, "Report version", "إصدار التقرير")} {latest.version}</span>
          <span>{tr(locale, "Issued", "صدر")} {latest.issuedAt.toISOString().replace("T"," ").slice(0,19)}</span>
          {templateConfig.showQr && <span>{tr(locale, "Scan QR to verify", "امسح QR للتحقق")}</span>}
        </div>
      </header>

      {latest.status === "AMENDED" && <div className="report-amended-banner">
        <strong>{tr(locale, "AMENDED REPORT", "تقرير معدل")}</strong>
        <span>{latest.amendmentReason || tr(locale, "A released result was amended.", "تم تعديل نتيجة صادرة.")}</span>
      </div>}

      <section className="report-patient-grid">
        <div><span>{tr(locale, "Patient", "المريض")}</span><strong>{locale === "ar" ? snapshot.patient.fullNameAr || snapshot.patient.fullNameEn : snapshot.patient.fullNameEn}</strong>{snapshot.patient.fullNameAr && <small dir="rtl">{snapshot.patient.fullNameAr}</small>}</div>
        <div><span>{tr(locale, "Patient No.", "رقم المريض")}</span><strong>{snapshot.patient.patientNumber}</strong></div>
        <div><span>{tr(locale, "Date of Birth", "تاريخ الميلاد")}</span><strong>{snapshot.patient.dateOfBirth || "—"}</strong></div>
        <div><span>{tr(locale, "Sex", "الجنس")}</span><strong>{sexLabel(locale, snapshot.patient.sexAtBirth)}</strong></div>
        <div><span>{tr(locale, "Accession", "رقم الطلب")}</span><strong>{snapshot.order.accessionNumber}</strong></div>
        <div><span>{tr(locale, "Priority", "الأولوية")}</span><strong>{priorityLabel(locale, snapshot.order.priority)}</strong></div>
        <div><span>{tr(locale, "Ordered", "تاريخ الطلب")}</span><strong>{snapshot.order.orderedAt.replace("T"," ").slice(0,19)}</strong></div>
        <div><span>{tr(locale, "Referrer", "المحيل")}</span><strong>{snapshot.referrer?.nameEn || "—"}</strong></div>
      </section>

      <section className="report-results">
        <table>
          <thead>
            <tr>
              {reportColumns.has("TEST") && <th>{tr(locale, "Test / Component", "الفحص / المكوّن")}</th>}
              {reportColumns.has("RESULT") && <th>{tr(locale, "Result", "النتيجة")}</th>}
              {reportColumns.has("FLAG") && <th>{tr(locale, "Flag", "العلامة")}</th>}
              {reportColumns.has("UNIT") && <th>{tr(locale, "Unit", "الوحدة")}</th>}
              {reportColumns.has("REFERENCE") && <th>{tr(locale, "Reference Range", "المجال المرجعي")}</th>}
            </tr>
          </thead>
          <tbody>
            {snapshot.results.map((result) => [
              <tr className="report-test-heading" key={`${result.testCode}-head`}>
                <td colSpan={reportColumnCount}>
                  <strong>{result.testCode} — {locale === "ar" ? result.testNameAr || result.testNameEn : result.testNameEn}</strong>
                  {result.testNameAr && <span dir="rtl"> · {result.testNameAr}</span>}
                  <small> · {result.performingBranch.nameEn} · {tr(locale, "Result", "النتيجة")} v{result.resultVersion}{result.analyzer ? ` · ${tr(locale, "Analyzer", "جهاز التحليل")}: ${result.analyzer.code}${result.analyzer.name ? " — " + result.analyzer.name : ""}` : ""}</small>
                </td>
              </tr>,
              ...result.values.map((value) => <tr key={`${result.testCode}-${value.componentCode}`} className={value.isCritical ? "report-critical-row" : ""}>
                {reportColumns.has("TEST") && <td>
                  <strong>{locale === "ar" ? value.componentNameAr || value.componentNameEn : value.componentNameEn}</strong>
                  {value.componentNameAr && <small dir="rtl">{value.componentNameAr}</small>}
                </td>}
                {reportColumns.has("RESULT") && <td><strong>{value.displayValue}</strong></td>}
                {reportColumns.has("FLAG") && <td>{value.flag === "UNKNOWN" ? "—" : <span className={"result-flag-badge flag-" + value.flag.toLowerCase().replaceAll("_","-")}>{value.flag}</span>}</td>}
                {reportColumns.has("UNIT") && <td>{value.unit || "—"}</td>}
                {reportColumns.has("REFERENCE") && <td>{referenceText(value, locale)}</td>}
              </tr>),
              result.microbiology ? <tr key={`${result.testCode}-microbiology`}>
                <td colSpan={reportColumnCount}>
                  <div className="report-notes">
                    <p><strong>{tr(locale, "Culture status", "حالة الزرع")}:</strong> {result.microbiology.cultureStatus.replaceAll("_", " ")}</p>
                    {result.microbiology.finalComment && <p><strong>{tr(locale, "Final interpretation", "التفسير النهائي")}:</strong> {result.microbiology.finalComment}</p>}
                    {result.microbiology.observations.length > 0 && <div>
                      <strong>{tr(locale, "Culture observations", "ملاحظات الزرع")}</strong>
                      <ul>{result.microbiology.observations.map((observation, index) =>
                        <li key={index}>{observation.type.replaceAll("_", " ")}: {observation.text}</li>
                      )}</ul>
                    </div>}
                    {result.microbiology.isolates.map(isolate => <div key={isolate.sequenceNumber} className="detail-section">
                      <p><strong>Isolate #{isolate.sequenceNumber}: {isolate.organism.code} — {isolate.organism.nameEn}</strong>
                        {isolate.quantityText ? ` · ${isolate.quantityText}` : ""}</p>
                      {isolate.colonyNotes && <p>{isolate.colonyNotes}</p>}
                      {isolate.susceptibilityTests.map((panel, panelIndex) => <div key={panelIndex}>
                        <p><strong>{tr(locale, "Susceptibility", "الحساسية")}:</strong> {panel.method || tr(locale, "Method not specified", "الطريقة غير محددة")}</p>
                        <table>
                          <thead><tr><th>{tr(locale, "Antibiotic", "المضاد الحيوي")}</th><th>S/I/R</th><th>MIC</th><th>{tr(locale, "Zone", "القطر")}</th><th>{tr(locale, "Breakpoint", "حد التفسير")}</th></tr></thead>
                          <tbody>{panel.results.map(item => <tr key={item.antibioticCode}>
                            <td>{item.antibioticCode} — {locale === "ar" ? item.antibioticNameAr || item.antibioticNameEn : item.antibioticNameEn}</td>
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
              result.comments && !result.microbiology ? <tr key={`${result.testCode}-comment`}><td colSpan={reportColumnCount}><strong>{tr(locale, "Comment", "تعليق")}:</strong> {result.comments}</td></tr> : null,
              <tr className="report-result-meta" key={`${result.testCode}-meta`}>
                <td colSpan={reportColumnCount}>
                  {tr(locale, "Specimen", "العينة")}: {result.specimen?.barcode || "—"} · {tr(locale, "Collected", "جُمعت")}: {result.specimen?.collectedAt?.replace("T"," ").slice(0,19) || "—"} ·
                  {templateConfig.showSignature ? <>{tr(locale, "Verified", "تم التحقق")}: {result.verifiedBy?.nameEn || "—"} · {tr(locale, "Released", "تم الإصدار")}: {result.releasedBy?.nameEn || "—"}</> : <>{tr(locale, "Released", "تم الإصدار")}: {result.releasedAt?.replace("T"," ").slice(0,19) || "—"}</>}
                </td>
              </tr>,
            ])}
          </tbody>
        </table>
      </section>

      {(snapshot.order.diagnosis || snapshot.order.clinicalNotes) && <section className="report-notes">
        {snapshot.order.diagnosis && <p><strong>{tr(locale, "Clinical indication", "الدلالة السريرية")}:</strong> {snapshot.order.diagnosis}</p>}
        {snapshot.order.clinicalNotes && <p><strong>{tr(locale, "Clinical notes", "الملاحظات السريرية")}:</strong> {snapshot.order.clinicalNotes}</p>}
      </section>}

      {(templateConfig.footerEn || templateConfig.footerAr) && <section className="report-template-footer">
        {templateConfig.footerEn && <p>{templateConfig.footerEn}</p>}
        {templateConfig.footerAr && <p dir="rtl">{templateConfig.footerAr}</p>}
      </section>}
      <footer className="report-footer">
        <div>
          <strong>{snapshot.completeness.final ? tr(locale, "Final report", "تقرير نهائي") : tr(locale, "Partial report", "تقرير جزئي")}</strong>
          <span>{snapshot.completeness.releasedItemCount}/{snapshot.completeness.totalItemCount} {tr(locale, "order item(s) released", "عنصر طلب تم إصداره")}</span>
        </div>
        <div>
          <span>{tr(locale, "Issued by", "صدر بواسطة")}: {latest.issuedBy.displayNameEn}</span>
          <span>{tr(locale, "Verification token", "رمز التحقق")}: {latest.verificationToken.slice(0,16)}…</span>
          {verificationUrl && <span className="verification-url">{verificationUrl}</span>}
        </div>
      </footer>
    </article>

    {latest.deliveries.length > 0 && <section className="table-card report-history no-print">
      <div className="table-toolbar"><h2>{tr(locale, "Delivery History", "سجل التسليم")}</h2><span>{latest.deliveries.length} {tr(locale, "event(s)", "حدث")}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{tr(locale, "Time", "الوقت")}</th><th>{tr(locale, "Channel", "القناة")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Recipient", "المستلم")}</th><th>{tr(locale, "User", "المستخدم")}</th></tr></thead><tbody>{latest.deliveries.map(event => <tr key={event.id}><td>{event.occurredAt.toISOString().replace("T"," ").slice(0,19)}</td><td>{event.channel}</td><td>{event.status}</td><td>{event.recipient || "—"}</td><td>{event.performedBy?.displayNameEn || tr(locale, "System", "النظام")}</td></tr>)}</tbody></table></div>
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
            <td>{version.issuedAt.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{version.issuedBy.displayNameEn}</td>
            <td>{version.branch.nameEn}</td>
            <td>{version.amendmentReason || "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
