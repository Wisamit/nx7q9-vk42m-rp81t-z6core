import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenRetentionManager } from "@/components/specimen-retention-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function RetainedSpecimensPage() {
  const session = await requirePermission("specimens.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const branchId = session.activeBranchId;
  const organizationId = session.user.organizationId;
  const authorized = branchId && session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === organizationId);
  if (!authorized) return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <section className="detail-card"><h1>{tr(locale, "Active branch scope required", "يلزم اختيار فرع نشط ومصرح به")}</h1></section>
  </main>;

  const [policies, cases, specimenTypes] = await Promise.all([
    prisma.specimenRetentionPolicy.findMany({
      where: { organizationId, branchId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, specimenTypeId: true, minimumDays: true, rationale: true,
        status: true, createdByUserId: true, approvedAt: true, createdAt: true },
    }),
    prisma.specimenDisposalCase.findMany({
      where: { organizationId, branchId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, status: true, reason: true, retentionDueAt: true,
        requestedByUserId: true, authorizedByUserId: true,
        specimen: { select: { barcode: true, status: true } },
        policy: { select: { minimumDays: true, status: true } } },
    }),
    prisma.specimenType.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
  ]);
  return <main className="catalog-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Specimen custody governance", "حوكمة حيازة العينات")}</p>
        <h1>{tr(locale, "Retention and Controlled Disposal", "الاحتفاظ بالعينات والإتلاف المراقب")}</h1>
        <p className="muted">{tr(locale,
          "Audited, branch-specific prospective retention and independent authorization before retained clinical material is disposed.",
          "سياسة احتفاظ مستقبلية لكل فرع مع سجل تدقيق وموافقة مستقلة قبل إتلاف العينات السريرية المحتفظ بها.")}</p>
      </div>
      <Link className="secondary-link" href="/specimens">{tr(locale, "Back to specimens", "العودة إلى العينات")}</Link>
    </header>
    <SpecimenRetentionManager locale={locale}
      policies={policies.map(p => ({ ...p, createdAt: p.createdAt.toISOString(),
        approvedAt: p.approvedAt?.toISOString() || null }))}
      cases={cases.map(c => ({ ...c, retentionDueAt: c.retentionDueAt.toISOString() }))}
      specimenTypes={specimenTypes}
      mayConfigure={permissions.has("settings.manage")}
      mayRequest={permissions.has("specimens.reject")}
      mayAuthorize={permissions.has("quality.nonconformance.manage")}
    />
  </main>;
}
