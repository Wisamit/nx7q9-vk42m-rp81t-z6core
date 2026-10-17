import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { OrganizationThemeOverride } from "@/components/organization-theme-override";
import { SystemDateText } from "@/components/system-date-text";
import { getOrganizationSystemSettings } from "@/lib/system-settings";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 4).map(part => part[0]?.toUpperCase()).join("");
}

export default async function VerifyReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) notFound();

  const version = await prisma.diagnosticReportVersion.findUnique({
    where: { verificationToken: token },
    include: {
      report: {
        include: {
          order: { include: { patient: true, orderingBranch: true, organization: true } },
        },
      },
      issuedBy: true,
    },
  });
  if (!version) notFound();

  const order = version.report.order;
  const snapshot = version.contentSnapshot as unknown as {
    patient?: { fullNameEn?: string; patientNumber?: string };
    organization?: { nameEn?: string; nameAr?: string | null };
    branch?: { nameEn?: string; nameAr?: string | null };
  };
  const current = version.status !== "RETRACTED" && version.version === version.report.currentVersion;
  const settings = await getOrganizationSystemSettings(order.organizationId);
  const locale = settings.defaultLocale;

  return <><OrganizationThemeOverride settings={settings} /><main className="verify-report-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="verify-report-card">
      {settings.logoDataUrl && <Image className="public-brand-logo" src={settings.logoDataUrl} alt={settings.systemNameEn} width={180} height={80} unoptimized priority />}
      <div className="verification-badge">{current ? tr(locale, "CURRENT REPORT", "تقرير ساري") : tr(locale, "NOT CURRENT / WITHDRAWN", "غير ساري / مسحوب")}</div>
      <h1>{tr(locale, "Diagnostic Report Verification", "التحقق من التقرير التشخيصي")}</h1>
      <p className="muted">{tr(locale, "This verification record was found in the issuing laboratory system.", "تم العثور على سجل التحقق هذا في نظام المختبر المُصدر.")}</p>

      <dl className="verification-grid">
        <dt>{tr(locale, "Laboratory", "المختبر")}</dt><dd>{locale === "ar" ? snapshot.organization?.nameAr || snapshot.organization?.nameEn || "—" : snapshot.organization?.nameEn || "—"}</dd>
        <dt>{tr(locale, "Branch", "الفرع")}</dt><dd>{locale === "ar" ? snapshot.branch?.nameAr || snapshot.branch?.nameEn || "—" : snapshot.branch?.nameEn || "—"}</dd>
        <dt>{tr(locale, "Accession", "رقم الطلب")}</dt><dd>{order.accessionNumber}</dd>
        <dt>{tr(locale, "Patient", "المريض")}</dt><dd>{initials(snapshot.patient?.fullNameEn || "")} · {snapshot.patient?.patientNumber || "—"}</dd>
        <dt>{tr(locale, "Report version", "إصدار التقرير")}</dt><dd>{version.version}</dd>
        <dt>{tr(locale, "Report status", "حالة التقرير")}</dt><dd>{statusLabel(locale, version.status)}</dd>
        <dt>{tr(locale, "Issued at", "وقت الإصدار")}</dt><dd><SystemDateText value={version.issuedAt.toISOString()} timeZone="UTC" /> UTC</dd>
        <dt>{tr(locale, "Issued by", "صدر بواسطة")}</dt><dd>{version.issuedBy.displayNameEn}</dd>
      </dl>

      {version.version !== version.report.currentVersion && <div className="report-amended-banner" role="alert">
        <strong>{tr(locale, "SUPERSEDED REPORT", "تقرير تم استبداله")}</strong>
        <span>{tr(locale, "This version has been superseded. Obtain the latest report from the laboratory before any clinical decision.", "تم استبدال هذا الإصدار. احصل على أحدث تقرير من المختبر قبل اتخاذ أي قرار سريري.")}</span>
      </div>}

      {version.status === "RETRACTED" && <div className="report-amended-banner">
        <strong>{tr(locale, "RETRACTED", "مسحوب")}</strong>
        <span>{tr(locale, "This report version should not be used for clinical decisions.", "يجب عدم استخدام هذا الإصدار من التقرير لاتخاذ قرارات سريرية.")}</span>
      </div>}

      <p className="verification-note">{tr(locale, "For privacy, this public verification page shows limited patient information. The complete clinical report remains available only through authorized LIS access or the issued document.", "حفاظًا على الخصوصية، تعرض صفحة التحقق العامة معلومات محدودة فقط عن المريض. يبقى التقرير السريري الكامل متاحًا عبر الوصول المصرح به للنظام أو الوثيقة الصادرة.")}</p>
    </section>
  </main></>;
}
