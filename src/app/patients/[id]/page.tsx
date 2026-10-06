import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, sexLabel, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.view");
  const { id } = await params;
  const locale = getUiLocale(session.user.preferredLocale);

  const patient = await prisma.patient.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { identifiers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
  });
  if (!patient) notFound();

  const duplicateCandidates = await prisma.patient.findMany({
    where: {
      organizationId: session.user.organizationId,
      id: { not: patient.id },
      status: "ACTIVE",
      OR: [
        { normalizedName: patient.normalizedName, ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}) },
        ...(patient.normalizedPhone ? [{ normalizedPhone: patient.normalizedPhone }] : []),
      ],
    },
    select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true, dateOfBirth: true, phone: true },
    take: 10,
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Patient Record", "سجل المريض")}</p>
        <h1>{locale === "ar" ? patient.fullNameAr || patient.fullNameEn : patient.fullNameEn}</h1>
        <p className="muted">{patient.patientNumber} · {tr(locale, "Organization-wide identity", "هوية موحدة على مستوى المؤسسة")}</p>
      </div>
      <Link className="secondary-link" href="/patients">{tr(locale, "Back to Patients", "العودة للمرضى")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Demographics", "البيانات الديموغرافية")}</h2>
        <dl>
          <dt>{tr(locale, "Patient #", "رقم المريض")}</dt><dd>{patient.patientNumber}</dd>
          <dt>{tr(locale, "English name", "الاسم بالإنجليزية")}</dt><dd>{patient.fullNameEn}</dd>
          <dt>{tr(locale, "Arabic name", "الاسم بالعربية")}</dt><dd dir="rtl">{patient.fullNameAr || "—"}</dd>
          <dt>{tr(locale, "Date of birth", "تاريخ الميلاد")}</dt><dd>{patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0,10) : "—"}</dd>
          <dt>{tr(locale, "Sex at birth", "الجنس عند الولادة")}</dt><dd>{sexLabel(locale, patient.sexAtBirth)}</dd>
          <dt>{tr(locale, "Phone", "الهاتف")}</dt><dd>{patient.phone || "—"}</dd>
          <dt>{tr(locale, "Email", "البريد الإلكتروني")}</dt><dd>{patient.email || "—"}</dd>
          <dt>{tr(locale, "Nationality", "الجنسية")}</dt><dd>{patient.nationalityCode || "—"}</dd>
          <dt>{tr(locale, "Status", "الحالة")}</dt><dd>{statusLabel(locale, patient.status)}</dd>
        </dl>
      </article>

      <article className="detail-card">
        <h2>{tr(locale, "Identifiers", "المعرّفات")}</h2>
        {patient.identifiers.length === 0 ? <p className="muted">{tr(locale, "No external identifiers recorded.", "لا توجد معرّفات خارجية مسجلة.")}</p> :
          <div className="summary-list">{patient.identifiers.map(identifier =>
            <div key={identifier.id}><span>{identifier.identifierType}{identifier.isPrimary ? ` · ${tr(locale, "Primary", "رئيسي")}` : ""}</span><strong>{identifier.value}</strong></div>
          )}</div>}
      </article>
    </section>

    <section className="detail-card">
      <h2>{tr(locale, "Potential Duplicates", "سجلات مكررة محتملة")}</h2>
      <p className="muted">{tr(locale, "Candidates are shown for review only. No patient records are merged or deleted automatically.", "تُعرض السجلات المحتملة للمراجعة فقط، ولا يتم دمج أو حذف أي سجل مريض تلقائيًا.")}</p>
      {duplicateCandidates.length === 0 ? <p className="muted">{tr(locale, "No likely duplicates found.", "لم يتم العثور على سجلات مكررة محتملة.")}</p> :
        <div className="summary-list">{duplicateCandidates.map(candidate =>
          <div key={candidate.id}>
            <span><Link className="table-link" href={`/patients/${candidate.id}`}>{candidate.patientNumber} · {candidate.fullNameEn}</Link></span>
            <strong>{candidate.dateOfBirth ? candidate.dateOfBirth.toISOString().slice(0,10) : tr(locale, "DOB —", "الميلاد —")} · {candidate.phone || tr(locale, "Phone —", "الهاتف —")}</strong>
          </div>
        )}</div>}
    </section>
  </main>;
}
