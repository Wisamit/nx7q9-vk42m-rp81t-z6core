import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ReportTemplateManager } from "@/components/report-template-manager";
import { tr } from "@/lib/ui-i18n";

export const dynamic="force-dynamic";

export default async function ReportTemplatesPage(){
  const session=await requirePermission("report_templates.view");
  const locale=session.user.preferredLocale==="ar"?"ar":"en";
  const branchIds=session.user.branchScopes.map(scope=>scope.branchId);
  const [branches,templates]=await Promise.all([
    prisma.branch.findMany({
      where:{organizationId:session.user.organizationId,id:{in:branchIds},status:"ACTIVE"},
      select:{id:true,code:true,nameEn:true,nameAr:true,timezone:true},
      orderBy:{nameEn:"asc"}
    }),
    prisma.reportTemplate.findMany({
      where:{organizationId:session.user.organizationId,OR:[{branchId:null},{branchId:{in:branchIds}}]},
      include:{versions:{orderBy:{version:"desc"},take:1}},
      orderBy:[{branchId:"asc"},{nameEn:"asc"}],
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Reporting Configuration","إعدادات التقارير")}</p>
        <h1>{tr(locale,"Report Template Designer","مصمم قوالب التقارير")}</h1>
        <p className="muted">{tr(locale,"Controlled, effective-dated report layouts. Released reports retain the exact template version snapshot used at issue time.","قوالب تقارير مضبوطة ومؤرخة بسريانها. التقارير الصادرة تحتفظ بنسخة القالب الدقيقة المستخدمة وقت الإصدار.")}</p>
      </div>
    </header>
    <ReportTemplateManager
      locale={locale}
      currentUserId={session.user.id}
      canManage={permissionSet(session).has("report_templates.manage")}
      branches={branches.map(b=>({id:b.id,code:b.code,nameEn:b.nameEn,nameAr:b.nameAr}))}
      templates={templates.map(t=>({id:t.id,code:t.code,nameEn:t.nameEn,nameAr:t.nameAr,branchId:t.branchId,latestVersion:t.versions[0]?.version||null,latestStatus:t.versions[0]?.status||null,latestVersionId:t.versions[0]?.id||null,latestSubmittedByUserId:t.versions[0]?.submittedByUserId||null,latestCreatedAt:t.versions[0]?.createdAt.toISOString()||null,latestTimeZone:branches.find(b=>b.id===t.branchId)?.timezone||null}))}
    />
  </main>;
}
