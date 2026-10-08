import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PatientMergePanel } from "@/components/patient-merge-panel";
import { calculatePatientAge } from "@/lib/patient-demographics";
import { getUiLocale, sexLabel, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.view");
  const { id } = await params;
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const canMerge = permissions.has("patients.merge");

  const patient = await prisma.patient.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      identifiers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      creationBranch: { select: { code: true, nameEn: true, nameAr: true } },
      portalAccount: { select: { id: true } },
      mergedInto: {
        select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true },
      },
      mergedFrom: {
        select: {
          id: true,
          patientNumber: true,
          fullNameEn: true,
          fullNameAr: true,
          mergedAt: true,
        },
        orderBy: { mergedAt: "desc" },
      },
      mergeEventsAsSource: {
        include: {
          targetPatient: { select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true } },
          mergedBy: { select: { displayNameEn: true, displayNameAr: true } },
        },
        orderBy: { mergedAt: "desc" },
        take: 1,
      },
      mergeEventsAsTarget: {
        include: {
          sourcePatient: { select: { id: true, patientNumber: true, fullNameEn: true, fullNameAr: true } },
          mergedBy: { select: { displayNameEn: true, displayNameAr: true } },
        },
        orderBy: { mergedAt: "desc" },
        take: 20,
      },
    },
  });
  if (!patient) notFound();

  const duplicateCandidates = patient.status === "ACTIVE" && !patient.mergedIntoPatientId
    ? await prisma.patient.findMany({
        where: {
          organizationId: session.user.organizationId,
          id: { not: patient.id },
          status: "ACTIVE",
          mergedIntoPatientId: null,
          OR: [
            { normalizedName: patient.normalizedName, ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}) },
            ...(patient.normalizedPhone ? [{ normalizedPhone: patient.normalizedPhone }] : []),
          ],
        },
        select: {
          id: true,
          patientNumber: true,
          fullNameEn: true,
          fullNameAr: true,
          dateOfBirth: true,
          phone: true,
          portalAccount: { select: { id: true } },
        },
        take: 10,
      })
    : [];

  const sourceMerge = patient.mergeEventsAsSource[0] || null;
  const age = calculatePatientAge(patient.dateOfBirth);
  const ageLabel = age
    ? age.value + " " + (
        age.unit === "YEAR"
          ? tr(locale, "year(s)", "سنة")
          : age.unit === "MONTH"
            ? tr(locale, "month(s)", "شهر")
            : tr(locale, "day(s)", "يوم")
      )
    : "—";

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Patient Record", "سجل المريض")}</p>
        <h1>{locale === "ar" ? patient.fullNameAr || patient.fullNameEn : patient.fullNameEn}</h1>
        <p className="muted">{patient.patientNumber} · {tr(locale, "Organization-wide identity", "هوية موحدة على مستوى المؤسسة")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href={"/patients/" + (patient.mergedIntoPatientId || patient.id) + "/history"}>{tr(locale, "Longitudinal History", "السجل الطولي")}</Link>
        <Link className="secondary-link" href="/patients">{tr(locale, "Back to Patients", "العودة للمرضى")}</Link>
      </div>
    </header>

    {patient.mergedInto && <section className="detail-card">
      <h2>{tr(locale, "Merged Patient Alias", "سجل مريض مدمج")}</h2>
      <p className="muted">{tr(
        locale,
        "This historical patient record is inactive and linked to the canonical patient. Historical orders/results remain attached here for traceability.",
        "هذا السجل التاريخي غير نشط ومرتبط بسجل المريض الأساسي. تبقى الطلبات والنتائج التاريخية مرتبطة به لأغراض التتبع.",
      )}</p>
      <p><strong>{tr(locale, "Canonical patient", "المريض الأساسي")}:</strong>{" "}
        <Link className="table-link" href={"/patients/" + patient.mergedInto.id}>
          {patient.mergedInto.patientNumber} · {locale === "ar" ? patient.mergedInto.fullNameAr || patient.mergedInto.fullNameEn : patient.mergedInto.fullNameEn}
        </Link>
      </p>
      {sourceMerge && <p className="muted">
        {tr(locale, "Merged", "تم الدمج")} {sourceMerge.mergedAt.toISOString().replace("T", " ").slice(0, 19)}
        {" · "}{tr(locale, "By", "بواسطة")} {locale === "ar" ? sourceMerge.mergedBy.displayNameAr || sourceMerge.mergedBy.displayNameEn : sourceMerge.mergedBy.displayNameEn}
        {" · "}{tr(locale, "Reason", "السبب")}: {sourceMerge.reason}
      </p>}
    </section>}

    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Demographics", "البيانات الديموغرافية")}</h2>
        <dl>
          <dt>{tr(locale, "Patient #", "رقم المريض")}</dt><dd>{patient.patientNumber}</dd>
          <dt>{tr(locale, "English name", "الاسم بالإنجليزية")}</dt><dd>{patient.fullNameEn}</dd>
          <dt>{tr(locale, "Arabic name", "الاسم بالعربية")}</dt><dd dir="rtl">{patient.fullNameAr || "—"}</dd>
          <dt>{tr(locale, "Date of birth", "تاريخ الميلاد")}</dt><dd>{patient.dateOfBirth ? patient.dateOfBirth.toISOString().slice(0,10) : "—"}</dd>
          <dt>{tr(locale, "Calculated age", "العمر المحسوب")}</dt><dd>{ageLabel}</dd>
          <dt>{tr(locale, "Sex at birth", "الجنس عند الولادة")}</dt><dd>{sexLabel(locale, patient.sexAtBirth)}</dd>
          <dt>{tr(locale, "Phone", "الهاتف")}</dt><dd>{patient.phone || "—"}</dd>
          <dt>{tr(locale, "WhatsApp", "واتساب")}</dt><dd>{patient.whatsapp || "—"}</dd>
          <dt>{tr(locale, "Email", "البريد الإلكتروني")}</dt><dd>{patient.email || "—"}</dd>
          <dt>{tr(locale, "Nationality", "الجنسية")}</dt><dd>{patient.nationalityCode || "—"}</dd>
          <dt>{tr(locale, "Creation branch", "فرع الإنشاء")}</dt><dd>{patient.creationBranch ? patient.creationBranch.code + " — " + (locale === "ar" ? patient.creationBranch.nameAr || patient.creationBranch.nameEn : patient.creationBranch.nameEn) : "—"}</dd>
          <dt>{tr(locale, "Status", "الحالة")}</dt><dd>{statusLabel(locale, patient.status)}</dd>
        </dl>
      </article>

      <article className="detail-card">
        <h2>{tr(locale, "Identifiers", "المعرّفات")}</h2>
        {patient.identifiers.length === 0 ? <p className="muted">{tr(locale, "No external identifiers recorded.", "لا توجد معرّفات خارجية مسجلة.")}</p> :
          <div className="summary-list">{patient.identifiers.map(identifier =>
            <div key={identifier.id}><span>{identifier.identifierType}{identifier.isPrimary ? " · " + tr(locale, "Primary", "رئيسي") : ""}</span><strong>{identifier.value}</strong></div>
          )}</div>}
      </article>
    </section>

    {(patient.addressEn || patient.addressAr || patient.clinicalInformation || patient.notes) && <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Address", "العنوان")}</h2>
        <dl>
          <dt>{tr(locale, "English", "الإنجليزية")}</dt><dd>{patient.addressEn || "—"}</dd>
          <dt>{tr(locale, "Arabic", "العربية")}</dt><dd dir="rtl">{patient.addressAr || "—"}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Clinical Information", "المعلومات السريرية")}</h2>
        <p>{patient.clinicalInformation || "—"}</p>
        <h3>{tr(locale, "Notes", "ملاحظات")}</h3>
        <p>{patient.notes || "—"}</p>
      </article>
    </section>}

    {patient.mergedFrom.length > 0 && <section className="detail-card">
      <h2>{tr(locale, "Merged Aliases", "السجلات المدمجة")}</h2>
      <p className="muted">{tr(
        locale,
        "These historical identities resolve to this canonical patient.",
        "هذه الهويات التاريخية مرتبطة بهذا المريض الأساسي.",
      )}</p>
      <div className="summary-list">{patient.mergedFrom.map(alias =>
        <div key={alias.id}>
          <span><Link className="table-link" href={"/patients/" + alias.id}>{alias.patientNumber} · {locale === "ar" ? alias.fullNameAr || alias.fullNameEn : alias.fullNameEn}</Link></span>
          <strong>{alias.mergedAt ? alias.mergedAt.toISOString().slice(0,10) : "—"}</strong>
        </div>
      )}</div>
    </section>}

    {canMerge && patient.status === "ACTIVE" && !patient.mergedIntoPatientId && <PatientMergePanel
      current={{
        id: patient.id,
        patientNumber: patient.patientNumber,
        fullNameEn: patient.fullNameEn,
        fullNameAr: patient.fullNameAr,
        dateOfBirth: patient.dateOfBirth?.toISOString().slice(0,10) || null,
        phone: patient.phone,
        hasPortalAccount: Boolean(patient.portalAccount),
      }}
      candidates={duplicateCandidates.map(candidate => ({
        id: candidate.id,
        patientNumber: candidate.patientNumber,
        fullNameEn: candidate.fullNameEn,
        fullNameAr: candidate.fullNameAr,
        dateOfBirth: candidate.dateOfBirth?.toISOString().slice(0,10) || null,
        phone: candidate.phone,
        hasPortalAccount: Boolean(candidate.portalAccount),
      }))}
      locale={locale}
    />}

    {!canMerge && patient.status === "ACTIVE" && duplicateCandidates.length > 0 && <section className="detail-card">
      <h2>{tr(locale, "Potential Duplicates", "سجلات مكررة محتملة")}</h2>
      <p className="muted">{tr(
        locale,
        "Potential duplicate records exist. A user with patient-merge permission must review and merge them.",
        "توجد سجلات مكررة محتملة. يجب على مستخدم لديه صلاحية دمج المرضى مراجعتها ودمجها.",
      )}</p>
      <div className="summary-list">{duplicateCandidates.map(candidate =>
        <div key={candidate.id}>
          <span><Link className="table-link" href={"/patients/" + candidate.id}>{candidate.patientNumber} · {candidate.fullNameEn}</Link></span>
          <strong>{candidate.dateOfBirth ? candidate.dateOfBirth.toISOString().slice(0,10) : tr(locale, "DOB —", "الميلاد —")} · {candidate.phone || tr(locale, "Phone —", "الهاتف —")}</strong>
        </div>
      )}</div>
    </section>}

    {patient.mergeEventsAsTarget.length > 0 && <section className="detail-card">
      <h2>{tr(locale, "Merge History", "سجل الدمج")}</h2>
      <div className="summary-list">{patient.mergeEventsAsTarget.map(event =>
        <div key={event.id}>
          <span>
            <Link className="table-link" href={"/patients/" + event.sourcePatient.id}>
              {event.sourcePatientNumberSnapshot} · {locale === "ar" ? event.sourcePatient.fullNameAr || event.sourcePatient.fullNameEn : event.sourcePatient.fullNameEn}
            </Link>
            <small className="table-subtext">{event.reason}</small>
          </span>
          <strong>{event.mergedAt.toISOString().replace("T"," ").slice(0,19)} · {locale === "ar" ? event.mergedBy.displayNameAr || event.mergedBy.displayNameEn : event.mergedBy.displayNameEn}</strong>
        </div>
      )}</div>
    </section>}
  </main>;
}
