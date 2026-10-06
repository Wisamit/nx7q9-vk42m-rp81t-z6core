import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PricingManager } from "@/components/pricing-manager";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await requirePermission("pricing.view");
  const locale = getUiLocale(session.user.preferredLocale);

  const accessibleBranchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [priceLists, branches, clients, contracts, tests, packages] = await Promise.all([
    prisma.priceList.findMany({
      where: { organizationId: session.user.organizationId, OR: [{ scopeType: { not: "BRANCH" } }, { branchId: { in: accessibleBranchIds } }] },
      include: { _count: { select: { items: true, packageItems: true } } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { nameEn: "asc" }],
      take: 200,
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: accessibleBranchIds }, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.contract.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.commercialPackage.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const scopeLabel = (value: string) => ({ ORGANIZATION: tr(locale,"Organization","المؤسسة"), BRANCH: tr(locale,"Branch","الفرع"), CLIENT: tr(locale,"Client","العميل"), CONTRACT: tr(locale,"Contract","العقد") }[value] || value);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing Configuration", "إعدادات الفوترة")}</p>
        <h1>{tr(locale, "Pricing", "الأسعار")}</h1>
        <p className="muted">{tr(locale, "Effective-dated organization, branch, client and contract price lists. Historical orders keep their original price snapshots.", "قوائم أسعار بتاريخ سريان للمؤسسة والفروع والعملاء والعقود، مع الحفاظ على الأسعار التاريخية للطلبات السابقة.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <PricingManager
      branches={branches.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, nameAr: x.nameAr }))}
      clients={clients.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, nameAr: x.nameAr }))}
      contracts={contracts.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, nameAr: x.nameAr, clientId: x.clientId }))}
      tests={tests}
      packages={packages}
      priceLists={priceLists.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, nameAr: x.nameAr, currency: x.currency }))}
      defaultCurrency={session.user.organization.defaultCurrency}
      locale={locale}
    />

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr(locale, "Price Lists", "قوائم الأسعار")}</h2><span>{priceLists.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Currency", "العملة")}</th><th>{tr(locale, "Priority", "الأولوية")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Items", "العناصر")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>
            {priceLists.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No price lists configured yet.", "لا توجد قوائم أسعار مهيأة بعد.")}</td></tr> :
              priceLists.map(list => <tr key={list.id}>
                <td><strong>{list.code}</strong></td>
                <td>{localizedName(list)}</td>
                <td>{scopeLabel(list.scopeType)}</td>
                <td>{list.currency}</td>
                <td>{list.priority}</td>
                <td>{list.effectiveFrom.toISOString().slice(0,10)} → {list.effectiveTo ? list.effectiveTo.toISOString().slice(0,10) : tr(locale, "Open", "مفتوح")}</td>
                <td>{list._count.items} {tr(locale, "tests", "فحوصات")} · {list._count.packageItems} {tr(locale, "packages", "باقات")}</td>
                <td>{statusLabel(locale, list.status)}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
