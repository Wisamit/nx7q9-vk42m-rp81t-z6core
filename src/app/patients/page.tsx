import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PatientCreateModal } from "@/components/patient-create-modal";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, sexLabel, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("patients.view");
  const query = (await searchParams).q?.trim() || "";
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const canManage = permissions.has("patients.manage");

  const [patients, identifierSchemes] = await Promise.all([
    prisma.patient.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(query ? {
        OR: [
          { patientNumber: { contains: query } },
          { fullNameEn: { contains: query } },
          { fullNameAr: { contains: query } },
          { phone: { contains: query } },
          { email: { contains: query } },
          { identifiers: { some: { value: { contains: query }, status: "ACTIVE" } } },
        ],
      } : {}),
    },
    include: {
      identifiers: { where: { status: "ACTIVE" }, take: 3 },
      mergedInto: { select: { id: true, patientNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    }),
    canManage ? prisma.patientIdentifierScheme.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        identifierType: "OTHER",
        code: { not: "LEGACY_OTHER" },
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        requiresIssuingCountry: true,
      },
      orderBy: { code: "asc" },
    }) : Promise.resolve([]),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Patient Registry", "سجل المرضى")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="patients" size={25} />{tr(locale, "Patients", "المرضى")}</h1>
        <p className="muted">{tr(locale, "Organization-wide patient identity shared across all branches, with duplicate protection and auditable identifiers.", "هوية موحدة للمريض على مستوى المؤسسة ومشتركة بين جميع الفروع مع حماية من التكرار ومعرّفات قابلة للتدقيق.")}</p>
      </div>
      <div className="header-actions">
        {canManage && <PatientCreateModal locale={locale} identifierSchemes={identifierSchemes} />}
        {canManage && <Link className="secondary-link" href="/patients/identifier-schemes">{tr(locale, "Identifier Schemes", "أنواع المعرّفات")}</Link>}
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Patient Search", "البحث عن المرضى")}</h2><span>{patients.length} {tr(locale, "shown", "ظاهر")}</span></div>
        <form className="inline-search" action="/patients" method="get">
          <input name="q" defaultValue={query} placeholder={tr(locale, "Patient #, name, phone, ID…", "رقم المريض، الاسم، الهاتف، الهوية…")} />
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Search", "بحث")}</button>
          {query && <Link className="secondary-link" href="/patients">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Patient #", "رقم المريض")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Date of birth", "تاريخ الميلاد")}</th><th>{tr(locale, "Sex", "الجنس")}</th><th>{tr(locale, "Phone", "الهاتف")}</th><th>{tr(locale, "National ID", "الرقم القومي")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>
            {patients.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No matching patients.", "لا يوجد مرضى مطابقون.")}</td></tr> :
              patients.map(patient => <tr key={patient.id}>
                <td><Link className="table-link" href={`/patients/${patient.id}`}><strong>{patient.patientNumber}</strong></Link></td>
                <td><Link className="table-link" href={`/patients/${patient.id}`}>{patient.fullNameEn}</Link>{patient.fullNameAr ? <><br/><small dir="rtl">{patient.fullNameAr}</small></> : null}</td>
                <td>{patient.dateOfBirth ? <SystemDateText value={patient.dateOfBirth.toISOString().slice(0,10)} kind="calendar" /> : "—"}</td>
                <td>{sexLabel(locale, patient.sexAtBirth)}</td>
                <td>{patient.phone || "—"}</td>
                <td>{patient.identifiers.find(i => i.identifierType === "NATIONAL_ID")?.value || "—"}</td>
                <td>
                  {statusLabel(locale, patient.status)}
                  {patient.mergedInto && <><br/><small>{tr(locale, "Merged into", "مدمج ضمن")} <Link className="table-link" href={"/patients/" + patient.mergedInto.id}>{patient.mergedInto.patientNumber}</Link></small></>}
                </td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
