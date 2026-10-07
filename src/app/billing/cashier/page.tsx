import Link from "next/link";
import { CashierShiftManager } from "@/components/cashier-shift-manager";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function CashierPage() {
  const session = await requirePermission("billing.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const permissions = permissionSet(session);
  const canManage = permissions.has("billing.manage");
  const canApprove = permissions.has("billing.cashier.approve");
  const accessibleBranches = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE");
  const branchIds = accessibleBranches.map(scope => scope.branchId);

  const shifts = await prisma.cashierShift.findMany({
    where: {
      organizationId: session.user.organizationId,
      branchId: { in: branchIds },
    },
    include: {
      branch: true,
      cashier: true,
      closures: { orderBy: { attemptNumber: "desc" }, take: 1 },
    },
    orderBy: { openedAt: "desc" },
    take: 200,
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing", "الفوترة")}</p>
        <h1>{tr(locale, "Cashier Shifts & Closing", "ورديات وإغلاق أمناء الصندوق")}</h1>
        <p className="muted">{tr(locale, "Reconcile opening cash, cash receipts and refunds against counted cash, then require independent approval.", "طابق النقد الافتتاحي والمقبوضات والاستردادات النقدية مع النقد الفعلي، ثم اطلب اعتمادًا مستقلاً.")}</p>
      </div>
      <div className="header-actions"><Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link></div>
    </header>
    <CashierShiftManager
      locale={locale}
      currentUserId={session.user.id}
      canManage={canManage}
      canApprove={canApprove}
      defaultBranchId={session.activeBranchId}
      branches={accessibleBranches.map(scope => ({
        id: scope.branch.id,
        code: scope.branch.code,
        name: locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn,
        defaultCurrency: scope.branch.defaultCurrency,
      }))}
      shifts={shifts.map(shift => ({
        id: shift.id,
        shiftNumber: shift.shiftNumber,
        branchCode: shift.branch.code,
        branchName: locale === "ar" ? shift.branch.nameAr || shift.branch.nameEn : shift.branch.nameEn,
        cashierName: locale === "ar" ? shift.cashier.displayNameAr || shift.cashier.displayNameEn : shift.cashier.displayNameEn,
        cashierUserId: shift.cashierUserId,
        currency: shift.currency,
        openingCash: shift.openingCash.toFixed(4),
        status: shift.status,
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt?.toISOString() || null,
        latestClosure: shift.closures[0] ? {
          id: shift.closures[0].id,
          attemptNumber: shift.closures[0].attemptNumber,
          status: shift.closures[0].status,
          cashReceipts: shift.closures[0].cashReceiptsSnapshot.toFixed(4),
          cashRefunds: shift.closures[0].cashRefundsSnapshot.toFixed(4),
          expectedCash: shift.closures[0].expectedCashSnapshot.toFixed(4),
          actualCash: shift.closures[0].actualCash.toFixed(4),
          differenceAmount: shift.closures[0].differenceAmount.toFixed(4),
          submittedAt: shift.closures[0].submittedAt.toISOString(),
          notes: shift.closures[0].notes,
          reviewNote: shift.closures[0].reviewNote,
        } : null,
      }))}
    />
  </main>;
}
