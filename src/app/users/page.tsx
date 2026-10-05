import { requirePermission } from "@/lib/auth";
import { UserManagement } from "@/components/user-management";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requirePermission("users.view");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  return <main className="catalog-shell"><header className="page-header"><div><p className="eyebrow">{locale === "ar" ? "الإدارة" : "Administration"}</p><h1>{locale === "ar" ? "المستخدمون" : "Users"}</h1><p className="muted">{locale === "ar" ? "إنشاء حسابات الموظفين وتحديد الأدوار والفروع المسموح بها." : "Create staff accounts and assign role-based permissions and branch scopes."}</p></div></header><UserManagement locale={locale} /></main>;
}
