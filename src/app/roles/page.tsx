import { permissionSet, requirePermission } from "@/lib/auth";
import { RoleManagement } from "@/components/role-management";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requirePermission("roles.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const canManageDiscountLimits = permissionSet(session).has("billing.discount.limits.manage");
  return <main className="catalog-shell"><header className="page-header"><div><p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p><h1>{locale === "ar" ? "الأدوار والصلاحيات" : "Roles & Permissions"}</h1><p className="muted">{locale === "ar" ? "إدارة الصلاحيات بطريقة Role-based مع الحفاظ على الأدوار النظامية." : "Manage role-based permissions while protecting system roles."}</p></div></header><RoleManagement locale={locale} canManageDiscountLimits={canManageDiscountLimits} /></main>;
}
