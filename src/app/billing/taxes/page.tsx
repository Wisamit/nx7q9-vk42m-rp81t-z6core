import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TaxRuleManager } from "@/components/tax-rule-manager";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function TaxRulesPage() {
  const session = await requirePermission("billing.tax.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const accessibleScopes = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE");
  const ids = accessibleScopes.map(scope => scope.branchId);
  if (!ids.length) notFound();
  const [activeBranchCount, tests, packages, rules] = await Promise.all([
    prisma.branch.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.commercialPackage.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: "asc" },
    }),
    prisma.taxRule.findMany({
      where: { organizationId: session.user.organizationId, OR: [{ branchId: { in: ids } }, { branchId: null }] },
      include: { branch: true, test: true, package: true },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const allBranches = ids.length === activeBranchCount;
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Tax Rules", "القواعد الضريبية")}</h1>
        <p className="muted">{tr(locale,
          "Configure service-specific tax by branch or organization; preserve exact issued tax history. No default percentage is imposed.",
          "هيّئ الضريبة حسب الخدمة والفرع أو المؤسسة مع حفظ القيم التاريخية كما صدرت. لا توجد نسبة مفروضة افتراضيًا."
        )}</p>
      </div>
      <div className="header-actions"><Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link></div>
    </header>
    <TaxRuleManager
      locale={locale}
      branches={accessibleScopes.map(scope => ({
        id: scope.branchId,
        code: scope.branch.code,
        name: locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn,
      }))}
      canOrganizationScope={allBranches}
      tests={tests.map(item => ({ id: item.id, code: item.code, name: locale === "ar" ? item.nameAr || item.nameEn : item.nameEn }))}
      packages={packages.map(item => ({ id: item.id, code: item.code, name: locale === "ar" ? item.nameAr || item.nameEn : item.nameEn }))}
      rules={rules.map(item => ({
        id: item.id,
        scope: item.branch ? item.branch.code : tr(locale, "Organization", "المؤسسة"),
        service: item.test
          ? (locale === "ar" ? item.test.nameAr || item.test.nameEn : item.test.nameEn)
          : item.package ? (locale === "ar" ? item.package.nameAr || item.package.nameEn : item.package.nameEn) : "—",
        code: item.code,
        name: locale === "ar" ? item.nameAr || item.nameEn : item.nameEn,
        treatment: item.treatment,
        priceMode: item.priceMode,
        rate: item.ratePercent.toFixed(2),
        effectiveFrom: item.effectiveFrom.toISOString().slice(0, 10),
        reason: item.reason,
      }))}
    />
  </main>;
}
