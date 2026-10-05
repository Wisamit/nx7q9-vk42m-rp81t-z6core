import { Prisma } from "../../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeReportTemplateConfiguration } from "@/lib/report-template";

function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("report_templates.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error:"invalid_request" }, { status:400 });

  const template = await prisma.reportTemplate.findFirst({
    where:{ id, organizationId:session.user.organizationId, status:"ACTIVE" },
    include:{ versions:{ orderBy:{ version:"desc" }, take:1 } },
  });
  if (!template) return NextResponse.json({ error:"template_not_found" }, { status:404 });
  if (template.branchId && !canAccessBranch(session, template.branchId)) return NextResponse.json({ error:"branch_forbidden" }, { status:403 });
  const latest=template.versions[0]||null;
  if (latest && ["DRAFT","APPROVED"].includes(latest.status)) return NextResponse.json({ error:"unreleased_template_version_exists" }, { status:409 });

  let configuration;
  try { configuration = normalizeReportTemplateConfiguration(body.configuration); }
  catch { return NextResponse.json({ error:"invalid_configuration" }, { status:400 }); }
  const changeSummary=text(body.changeSummary,1000);
  if(!changeSummary) return NextResponse.json({ error:"change_summary_required" }, { status:400 });

  const created=await prisma.$transaction(async tx=>{
    const version=await tx.reportTemplateVersion.create({data:{
      templateId:template.id, version:(latest?.version||0)+1,
      configuration:configuration as unknown as Prisma.InputJsonValue,
      changeSummary, submittedByUserId:session.user.id, supersedesVersionId:latest?.id||null,
    }});
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId, branchId:template.branchId||session.activeBranchId, actorUserId:session.user.id,
      action:"REPORT_TEMPLATE_VERSION_CREATED", entityType:"ReportTemplateVersion", entityId:version.id,
      newValues:{templateId:template.id,version:version.version},reason:changeSummary,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return version;
  });
  return NextResponse.json({status:"ok",version:created},{status:201});
}
