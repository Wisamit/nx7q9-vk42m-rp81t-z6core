import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { RoleManagement } from "@/components/role-management";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requirePermission("roles.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const permissions = permissionSet(session);
  const canManageDiscountLimits = permissions.has("billing.discount.limits.manage");
  const canManageCashierAuthority = permissions.has("billing.cashier.authority.manage");
  const canManageCreditLimits = permissions.has("billing.credit.limits.manage");
  const canManageTaxRules = permissions.has("billing.tax.manage");
  return <main className="catalog-shell"><header className="page-header"><div><p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p><h1>{locale === "ar" ? "الأدوار والصلاحيات" : "Roles & Permissions"}</h1><p className="muted">{locale === "ar" ? "إدارة الصلاحيات بطريقة Role-based مع الحفاظ على الأدوار النظامية." : "Manage role-based permissions while protecting system roles."}</p></div>{permissions.has("users.view") && <div className="header-actions"><Link className="secondary-link" href="/users">{locale === "ar" ? "إدارة المستخدمين" : "Manage Users"}</Link></div>}</header><RoleManagement locale={locale} canManageDiscountLimits={canManageDiscountLimits} canManageCashierAuthority={canManageCashierAuthority} canManageCreditLimits={canManageCreditLimits} canManageTaxRules={canManageTaxRules} /></main>;
}
