import Link from "next/link";
import { isActiveSystemAdmin } from "@/lib/staff-password-policy";
import { permissionSet, requirePermission } from "@/lib/auth";
import { UserManagement } from "@/components/user-management";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requirePermission("users.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const canViewRoles = permissionSet(session).has("roles.view");
  const canViewBranches = permissionSet(session).has("branches.view") || permissionSet(session).has("branches.manage");
  const canManageDiscountLimits = permissionSet(session).has("billing.discount.limits.manage");
  const canResetPasswords = permissionSet(session).has("users.manage") && isActiveSystemAdmin(session.user.roles);
  return <main className="catalog-shell"><header className="page-header"><div><p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p><h1>{locale === "ar" ? "المستخدمون" : "Users"}</h1><p className="muted">{locale === "ar" ? "إنشاء حسابات الموظفين وتحديد الأدوار والفروع المسموح بها." : "Create staff accounts and assign role-based permissions and branch scopes."}</p></div><div className="header-actions">{canViewRoles && <Link className="secondary-link" href="/roles">{locale === "ar" ? "الأدوار والصلاحيات" : "Roles & Permissions"}</Link>}{canViewBranches && <Link className="secondary-link" href="/organization/branches">{locale === "ar" ? "الفروع" : "Branches"}</Link>}</div></header><UserManagement locale={locale} canManageDiscountLimits={canManageDiscountLimits} canResetPasswords={canResetPasswords} currentUserId={session.user.id} /></main>;
}
