import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const session = await requirePermission("report_templates.manage");
  const ctx = await requestContext();
  const { id, versionId } = await params;
  const body = await request.json().catch(() => ({})) as { effectiveFrom?: unknown };
  const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return NextResponse.json({ error:"invalid_effective_from" }, { status:400 });

  const version = await prisma.reportTemplateVersion.findFirst({
    where:{ id:versionId, templateId:id, template:{ organizationId:session.user.organizationId, status:"ACTIVE" } },
    include:{ template:true },
  });
  if(!version) return NextResponse.json({ error:"template_version_not_found" }, { status:404 });
  if(version.template.branchId && !canAccessBranch(session,version.template.branchId)) return NextResponse.json({ error:"branch_forbidden" }, { status:403 });
  if(!["DRAFT","APPROVED"].includes(version.status)) return NextResponse.json({ error:"version_not_activatable", status:version.status }, { status:409 });

  const now=new Date();
  const activated=await prisma.$transaction(async tx=>{
    await tx.reportTemplateVersion.updateMany({
      where:{ templateId:id, status:"EFFECTIVE", id:{not:version.id} },
      data:{ status:"RETIRED", effectiveTo:effectiveFrom, retiredAt:now },
    });
    const updated=await tx.reportTemplateVersion.update({
      where:{id:version.id},
      data:{ status:"EFFECTIVE", approvedByUserId:session.user.id, approvedAt:now, effectiveFrom, effectiveTo:null },
    });
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId, branchId:version.template.branchId||session.activeBranchId, actorUserId:session.user.id,
      action:"REPORT_TEMPLATE_VERSION_ACTIVATED", entityType:"ReportTemplateVersion", entityId:updated.id,
      oldValues:{status:version.status},newValues:{status:"EFFECTIVE",effectiveFrom},
      reason:"Controlled report template activation",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return updated;
  });
  return NextResponse.json({status:"ok",version:activated});
}
