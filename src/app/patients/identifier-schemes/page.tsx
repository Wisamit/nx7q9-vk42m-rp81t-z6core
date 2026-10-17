import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PatientIdentifierSchemeManager } from "@/components/patient-identifier-scheme-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PatientIdentifierSchemesPage() {
  const session = await requirePermission("patients.manage");
  const locale = getUiLocale(session.user.preferredLocale);
  const schemes = await prisma.patientIdentifierScheme.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: [{ status: "asc" }, { identifierType: "asc" }, { code: "asc" }],
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Patient Master", "سجل المرضى")}</p>
        <h1>{tr(locale, "Identifier Schemes", "أنواع معرّفات المرضى")}</h1>
        <p className="muted">{tr(
          locale,
          "Configure organization-wide patient identifier types without changing historical identifiers.",
          "إعداد أنواع معرّفات المرضى على مستوى المؤسسة دون تغيير المعرّفات التاريخية.",
        )}</p>
      </div>
      <div className="header-actions"><Link className="secondary-link" href="/patients">{tr(locale, "Back to Patients", "العودة للمرضى")}</Link></div>
    </header>
    <PatientIdentifierSchemeManager schemes={schemes.map(item => ({...item, updatedAt: item.updatedAt.toISOString()}))} locale={locale} />
  </main>;
}
