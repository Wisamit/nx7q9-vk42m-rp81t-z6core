import { doctorAccessWhere, hasLiveDoctorPortalReferrer } from "@/lib/doctor-portal-access";
import { Fragment } from "react";
import { SystemDateText } from "@/components/system-date-text";
import { notFound } from "next/navigation";
import { requirePortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { requestContext } from "@/lib/auth";
import { getUiLocale, priorityLabel, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

type ReportSnapshot = {
  organization?: { nameEn?: string; nameAr?: string | null };
  branch?: { nameEn?: string; nameAr?: string | null };
  patient?: { patientNumber?: string; fullNameEn?: string; fullNameAr?: string | null; dateOfBirth?: string | null; sexAtBirth?: string };
  order?: { accessionNumber?: string; orderedAt?: string; priority?: string };
  reportInterpretation?: { id: string; revisionNumber: number; textEn: string;
    textAr: string; approvedAt: string | null; approvedByUserId: string | null } | null;
  results?: Array<{
    testCode?: string;
    testNameEn?: string;
    testNameAr?: string | null;
    comments?: string | null;
    values?: Array<{
      componentCode?: string;
      componentNameEn?: string;
      componentNameAr?: string | null;
      displayValue?: string | null;
      unit?: string | null;
      flag?: string;
      comments?: string | null;
      referenceLow?: string | null;
      referenceHigh?: string | null;
      referenceTextEn?: string | null;
      referenceTextAr?: string | null;
    }>;
  }>;
};

export default async function PortalReportPage({ params }: { params: Promise<{ versionId: string }> }) {
  const session = await requirePortalSession();
  const { versionId } = await params;
  const account = session.portalAccount;
  // A previously issued session must not disclose clinical information
  // if its physician link has since been disabled or reassigned.
  if (account.type === "DOCTOR" && !hasLiveDoctorPortalReferrer(account)) notFound();

  const locale = getUiLocale(account.preferredLocale);
  const version = await prisma.diagnosticReportVersion.findUnique({
    where: { id: versionId },
    include: { branch: { select: { timezone: true } }, report: { include: { order: true } } },
  });
  if (!version || version.report.order.organizationId !== account.organizationId) notFound();

  const order = version.report.order;
  let allowed = false;
  if (account.type === "PATIENT") {
    allowed = order.patientId === account.patientId;
  } else if (account.type === "DOCTOR") {
    allowed = Boolean(account.referrerId && await prisma.labOrder.findFirst({
      where: { id: order.id, ...doctorAccessWhere({ organizationId: account.organizationId,
        referrerId: account.referrerId, capability: "reports", now: new Date() }) },
      select: { id: true },
    }));
  } else if (account.type === "CORPORATE" && order.clientId === account.clientId) {
    const access = await prisma.corporatePortalPatientAccess.findFirst({
      where: {
        clientId: account.clientId!,
        patientId: order.patientId,
        canViewReports: true,
        status: "ACTIVE",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { id: true },
    });
    allowed = Boolean(access);
  }
  if (!allowed) notFound();

  // Withdrawn versions must never expose clinical values through the portal
  // and must not create a false PORTAL/DELIVERED receipt.
  if (version.status === "RETRACTED") {
    const ctx = await requestContext();
    await prisma.auditEvent.create({
      data: {
        organizationId: account.organizationId,
        branchId: version.branchId,
        actorUserId: null,
        action: "PORTAL_RETRACTED_REPORT_VIEW_BLOCKED",
        entityType: "DiagnosticReportVersion",
        entityId: version.id,
        sessionId: session.id,
        newValues: { reportId: version.reportId, version: version.version, reason: "RETRACTED" },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="detail-card" role="alert">
        <h1>{tr(locale, "Report retracted", "التقرير مسحوب")}</h1>
        <p>{tr(locale, "This report was withdrawn and must not be used for clinical decisions. Contact the laboratory for the currently valid report.", "تم سحب هذا التقرير ولا يجوز استخدامه لاتخاذ قرارات سريرية. تواصل مع المختبر للحصول على التقرير الساري.")}</p>
        <a className="secondary-link" href="/portal">{tr(locale, "Back to Portal", "العودة للبوابة")}</a>
      </section>
    </main>;
  }

  const ctx = await requestContext();
  await prisma.$transaction([
    prisma.reportDeliveryEvent.create({
      data: {
        reportVersionId: version.id,
        channel: "PORTAL",
        status: "DELIVERED",
        recipient: account.type,
        externalRef: session.id,
        details: {
          portalAccountId: account.id,
          accountType: account.type,
          sessionId: session.id,
        },
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: account.organizationId,
        branchId: version.branchId,
        actorUserId: null,
        action: "PORTAL_REPORT_VIEWED",
        entityType: "DiagnosticReportVersion",
        entityId: version.id,
        sessionId: session.id,
        newValues: { reportId: version.reportId, version: version.version, accountType: account.type },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    }),
  ]);

  const snapshot = version.contentSnapshot as unknown as ReportSnapshot;
  return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Diagnostic Report", "التقرير التشخيصي")} · v{version.version}</p>
        <h1>{locale === "ar" ? snapshot.organization?.nameAr || snapshot.organization?.nameEn || "Family Lab" : snapshot.organization?.nameEn || "Family Lab"}</h1>
        <p className="muted">{locale === "ar" ? snapshot.branch?.nameAr || snapshot.branch?.nameEn || "" : snapshot.branch?.nameEn || ""} · {statusLabel(locale, version.status)} · {tr(locale, "Issued", "صدر")} <SystemDateText value={version.issuedAt.toISOString()} timeZone={version.branch.timezone} /></p>
      </div>
      <a className="secondary-link" href="/portal">{tr(locale, "Back to Portal", "العودة للبوابة")}</a>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Patient", "المريض")}</h2><strong>{locale === "ar" ? snapshot.patient?.fullNameAr || snapshot.patient?.fullNameEn || "—" : snapshot.patient?.fullNameEn || "—"}</strong><p className="muted">{snapshot.patient?.patientNumber || ""}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Accession", "رقم الطلب")}</h2><strong>{snapshot.order?.accessionNumber || "—"}</strong><p className="muted">{priorityLabel(locale, snapshot.order?.priority)}</p></article>
      <article className="detail-card"><h2>{tr(locale, "Report Version", "إصدار التقرير")}</h2><strong>v{version.version}</strong><p className="muted">{statusLabel(locale, version.status)}</p></article>
    </section>

    {version.report.currentVersion !== version.version && <section className="detail-card" role="alert">
      <strong>{tr(locale, "Superseded report version — not current", "إصدار تقرير قديم — ليس الإصدار الحالي")}</strong>
      <p>{tr(locale, "This historical report was replaced by a newer version. Review the latest version before making clinical decisions.", "تم استبدال هذا التقرير التاريخي بإصدار أحدث. راجع أحدث إصدار قبل اتخاذ قرارات سريرية.")}</p>
    </section>}

    {snapshot.reportInterpretation && <section className="detail-card">
      <h2>{tr(locale, "Approved report interpretation", "التفسير السريري المعتمد")} · v{snapshot.reportInterpretation.revisionNumber}</h2>
      <p dir={locale === "ar" ? "rtl" : "ltr"} style={{ whiteSpace: "pre-wrap" }}>
        {locale === "ar" ? snapshot.reportInterpretation.textAr : snapshot.reportInterpretation.textEn}
      </p>
    </section>}

    {(snapshot.results || []).map((result, index) => <section className="table-card detail-section" key={(result.testCode || "test") + index}>
      <div className="table-toolbar"><h2>{result.testCode} — {locale === "ar" ? result.testNameAr || result.testNameEn : result.testNameEn}</h2></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Component", "المكوّن")}</th><th>{tr(locale, "Result", "النتيجة")}</th><th>{tr(locale, "Flag", "العلامة")}</th><th>{tr(locale, "Unit", "الوحدة")}</th><th>{tr(locale, "Reference", "المرجع")}</th></tr></thead>
        <tbody>{(result.values || []).map((value, valueIndex) => <Fragment key={(value.componentCode || "component") + valueIndex}>
          <tr>
            <td>{value.componentCode}<br/><small>{locale === "ar" ? value.componentNameAr || value.componentNameEn : value.componentNameEn}</small></td>
            <td><strong>{value.displayValue || "—"}</strong></td>
            <td>{value.flag || "—"}</td>
            <td>{value.unit || "—"}</td>
            <td>{(locale === "ar" ? value.referenceTextAr || value.referenceTextEn : value.referenceTextEn) || [value.referenceLow, value.referenceHigh].filter(Boolean).join(" – ") || "—"}</td>
          </tr>
          {value.comments && <tr><td colSpan={5}><strong>{tr(locale, "Component comment", "تعليق المكوّن")}:</strong> {value.comments}</td></tr>}
        </Fragment>)}</tbody>
      </table></div>
      {result.comments && <p className="muted">{result.comments}</p>}
    </section>)}
  </main>;
}
