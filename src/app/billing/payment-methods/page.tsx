import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PaymentMethodManager } from "@/components/payment-method-manager";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage() {
  const session = await requirePermission("billing.payment_methods.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  if (!permissionSet(session).has("billing.payment_methods.manage")) notFound();

  const activeBranches = await prisma.branch.findMany({
    where: { organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  const accessible = new Set(session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));
  if (!activeBranches.length || activeBranches.some(branch => !accessible.has(branch.id))) notFound();

  const methods = await prisma.paymentMethodConfig.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Billing Configuration", "إعدادات الفوترة")}</p>
        <h1>{tr(locale, "Payment Methods", "طرق الدفع")}</h1>
        <p className="muted">{tr(
          locale,
          "Configure operational settlement methods while preserving stable accounting behavior and immutable historical snapshots.",
          "هيّئ طرق التسوية التشغيلية مع الحفاظ على السلوك المحاسبي الثابت واللقطات التاريخية غير القابلة للتغيير.",
        )}</p>
      </div>
      <Link className="secondary-link" href="/billing">{tr(locale, "Back to Billing", "العودة للفوترة")}</Link>
    </header>
    <PaymentMethodManager
      locale={locale}
      methods={methods.map(method => ({
        id: method.id,
        code: method.code,
        nameEn: method.nameEn,
        nameAr: method.nameAr,
        baseMethod: method.baseMethod,
        requiresReference: method.requiresReference,
        sortOrder: method.sortOrder,
        status: method.status,
        isSettlement: method.isSettlement,
      }))}
    />
  </main>;
}
