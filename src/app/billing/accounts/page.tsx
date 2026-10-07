import Link from "next/link";
import { ClientAccountManager } from "@/components/client-account-manager";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function ClientAccountsPage() {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const permissions = permissionSet(session);
  const canManage = permissions.has("billing.manage");
  const accessibleScopes = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE");
  const branchIds = accessibleScopes.map(scope => scope.branchId);

  const activeBranchCount = await prisma.branch.count({
    where: { organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  const hasAllBranches = branchIds.length === activeBranchCount;

  const [clients, openInvoices, statements] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
      take: 500,
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        clientId: { not: null },
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        balanceAmount: { gt: 0 },
      },
      include: { branch: true },
      orderBy: { issuedAt: "asc" },
      take: 1000,
    }),
    prisma.clientAccountStatement.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { branchId: { in: branchIds } },
          ...(hasAllBranches ? [{ branchId: null }] : []),
        ],
      },
      orderBy: { generatedAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Client & Corporate Accounts", "حسابات العملاء والشركات")}</h1>
        <p className="muted">{tr(locale, "Generate immutable statements and allocate one client payment across multiple invoices without altering historical invoice values.", "أنشئ كشوف حساب تاريخية ثابتة ووزّع دفعة عميل واحدة على عدة فواتير دون تغيير قيم الفواتير التاريخية.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/billing/accounts/aging">{tr(locale, "A/R Aging", "أعمار الذمم")}</Link>
        {permissions.has("billing.credit.limits.manage") && hasAllBranches && <Link className="secondary-link" href="/billing/accounts/credit-limits">{tr(locale, "Credit Limits", "حدود الائتمان")}</Link>}
        <Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link>
        <Link className="secondary-link" href="/referrers">{tr(locale, "Clients", "العملاء")}</Link>
      </div>
    </header>

    <ClientAccountManager
      locale={locale}
      canManage={canManage}
      hasAllBranches={hasAllBranches}
      defaultBranchId={session.activeBranchId}
      clients={clients.map(client => ({
        id: client.id,
        code: client.code,
        name: locale === "ar" ? client.nameAr || client.nameEn : client.nameEn,
        paymentTermsDays: client.paymentTermsDays,
      }))}
      branches={accessibleScopes.map(scope => ({
        id: scope.branch.id,
        code: scope.branch.code,
        name: locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn,
        defaultCurrency: scope.branch.defaultCurrency,
      }))}
      invoices={openInvoices.map(invoice => ({
        id: invoice.id,
        clientId: invoice.clientId!,
        branchId: invoice.branchId,
        branchCode: invoice.branch.code,
        invoiceNumber: invoice.invoiceNumber,
        currency: invoice.currency,
        balanceAmount: invoice.balanceAmount.toFixed(4),
        issuedAt: invoice.issuedAt.toISOString(),
      }))}
      statements={statements.map(statement => ({
        id: statement.id,
        statementNumber: statement.statementNumber,
        clientName: locale === "ar" ? statement.clientNameArSnapshot || statement.clientNameEnSnapshot : statement.clientNameEnSnapshot,
        clientCode: statement.clientCodeSnapshot,
        branchLabel: statement.branchCodeSnapshot || tr(locale, "All branches", "جميع الفروع"),
        currency: statement.currency,
        periodStart: statement.periodStart.toISOString().slice(0,10),
        periodEnd: statement.periodEnd.toISOString().slice(0,10),
        openingBalance: statement.openingBalance.toFixed(4),
        invoiceCharges: statement.invoiceCharges.toFixed(4),
        creditNotes: statement.creditNotes.toFixed(4),
        payments: statement.payments.toFixed(4),
        refunds: statement.refunds.toFixed(4),
        closingBalance: statement.closingBalance.toFixed(4),
        generatedAt: statement.generatedAt.toISOString(),
        status: statement.status,
      }))}
    />
  </main>;
}
