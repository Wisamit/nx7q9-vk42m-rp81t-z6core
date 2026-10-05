import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ReportTemplateManager } from "@/components/report-template-manager";

export const dynamic="force-dynamic";

export default async function ReportTemplatesPage(){
  const session=await requirePermission("report_templates.view");
  const branchIds=session.user.branchScopes.map(scope=>scope.branchId);
  const [branches,templates]=await Promise.all([
    prisma.branch.findMany({where:{organizationId:session.user.organizationId,id:{in:branchIds},status:"ACTIVE"},select:{id:true,code:true,nameEn:true},orderBy:{nameEn:"asc"}}),
    prisma.reportTemplate.findMany({
      where:{organizationId:session.user.organizationId,OR:[{branchId:null},{branchId:{in:branchIds}}]},
      include:{versions:{orderBy:{version:"desc"},take:1}},
      orderBy:[{branchId:"asc"},{nameEn:"asc"}],
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header"><div><p className="eyebrow">Reporting Configuration</p><h1>Report Template Designer</h1><p className="muted">Controlled, effective-dated report layouts. Released reports retain the exact template version snapshot used at issue time.</p></div></header>
    <ReportTemplateManager
      branches={branches.map(b=>({id:b.id,code:b.code,name:b.nameEn}))}
      templates={templates.map(t=>({id:t.id,code:t.code,name:t.nameEn,branchId:t.branchId,latestVersion:t.versions[0]?.version||null,latestStatus:t.versions[0]?.status||null,latestVersionId:t.versions[0]?.id||null}))}
    />
  </main>;
}
