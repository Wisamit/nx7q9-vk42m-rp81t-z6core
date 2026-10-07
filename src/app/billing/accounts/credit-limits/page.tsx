import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "../../../../../generated/prisma/client";
import { ClientCreditLimitManager } from "@/components/client-credit-limit-manager";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ClientCreditLimitsPage() {
  const session = await requirePermission("billing.credit.limits.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const branchIds = new Set(session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));

  const [activeBranches, clients, policies] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.clientCreditPolicy.findMany({
      where: { organizationId: session.user.organizationId },
      include: { client: true },
      orderBy: [{ currency: "asc" }, { client: { nameEn: "asc" } }],
    }),
  ]);
  if (activeBranches.length === 0 || activeBranches.some(branch => !branchIds.has(branch.id))) notFound();

  const exposureByAccount = await prisma.invoice.groupBy({
    by: ["clientId", "currency"],
    where: {
      organizationId: session.user.organizationId,
      clientId: { in: policies.map(policy => policy.clientId) },
      currency: { in: [...new Set(policies.map(policy => policy.currency))] },
      status: { not: "VOID" },
      balanceAmount: { gt: 0 },
    },
    _sum: { balanceAmount: true },
  });
  const exposureMap = new Map(exposureByAccount.map(item => [
    item.clientId + "|" + item.currency,
    item._sum.balanceAmount ?? new Prisma.Decimal(0),
  ]));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Client Credit Limits & Control", "حدود ائتمان العملاء والتحكم بها")}</h1>
        <p className="muted">{tr(locale,
          "Policies apply to each client/currency across every branch. Over-limit blocking is enforced inside order registration.",
          "تُطبق السياسة على كل عميل وعملة عبر جميع الفروع، ويُفحص تجاوز الحد داخل معاملة تسجيل الطلب."
        )}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/billing/accounts">{tr(locale, "Client Accounts", "حسابات العملاء")}</Link>
        <Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link>
      </div>
    </header>

    <ClientCreditLimitManager
      locale={locale}
      clients={clients.map(client => ({
        id: client.id,
        code: client.code,
        name: locale === "ar" ? client.nameAr || client.nameEn : client.nameEn,
      }))}
      policies={policies.map(policy => {
        const exposure = exposureMap.get(policy.clientId + "|" + policy.currency) ?? new Prisma.Decimal(0);
        const remaining = policy.limitAmount.sub(exposure);
        return {
          id: policy.id,
          clientId: policy.clientId,
          clientCode: policy.client.code,
          clientName: locale === "ar" ? policy.client.nameAr || policy.client.nameEn : policy.client.nameEn,
          currency: policy.currency,
          mode: policy.mode,
          limitAmount: policy.limitAmount.toFixed(4),
          exposure: exposure.toFixed(4),
          remaining: remaining.toFixed(4),
          utilizationExceeded: remaining.lt(0),
          updatedAt: policy.updatedAt.toISOString(),
          reason: policy.reason,
        };
      })}
    />
  </main>;
}
