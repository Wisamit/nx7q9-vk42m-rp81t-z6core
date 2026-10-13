import { redirect } from "next/navigation";
import { permissionSet, requireSession } from "@/lib/auth";
import { OrganizationStructureManager } from "@/components/organization-structure-manager";
import { tr } from "@/lib/ui-i18n";
export const dynamic = "force-dynamic";

export default async function OrganizationBranchesPage() {
  const session = await requireSession();
  const allowed = permissionSet(session);
  if (!allowed.has("branches.view") && !allowed.has("branches.manage")) redirect("/dashboard?forbidden=1");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  return <main className="catalog-shell" dir={locale==="ar"?"rtl":"ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Organization Operations","العمليات المؤسسية")}</p>
        <h1>{tr(locale,"Branches, Departments & Workstations","الفروع والأقسام ومحطات العمل")}</h1>
        <p className="muted">{tr(locale,
          "Manage branch identity, local working hours and department/workstation structures. Branch and department codes remain stable to protect historical references.",
          "إدارة هوية الفروع وساعات العمل المحلية والأقسام ومحطات العمل. تبقى رموز الفروع والأقسام ثابتة لحماية السجلات التاريخية.")}</p>
      </div>
    </header>
    <OrganizationStructureManager locale={locale} canManage={allowed.has("branches.manage")} />
  </main>;
}
