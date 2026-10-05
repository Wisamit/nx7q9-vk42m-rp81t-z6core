import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const CHANNELS = ["IN_APP","EMAIL","SMS","WHATSAPP"] as const;
function text(value: unknown, max=5000){ return typeof value === "string" ? value.trim().slice(0,max) : ""; }

export async function GET() {
  const session = await requirePermission("notifications.view");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const templates = await prisma.notificationTemplate.findMany({
    where: {
      organizationId: session.user.organizationId,
      OR: [{ branchId: null }, { branchId: { in: branchIds } }],
    },
    include: { branch: true, createdBy: true },
    orderBy: [{ eventType: "asc" }, { code: "asc" }, { version: "desc" }],
    take: 500,
  });
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const session = await requirePermission("notifications.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(()=>null);
  if(!body) return NextResponse.json({error:"invalid_request"},{status:400});

  const branchId = text(body.branchId,36) || null;
  const code = text(body.code,100).toUpperCase();
  const eventType = text(body.eventType,120).toUpperCase();
  const channel = CHANNELS.includes(body.channel) ? body.channel as typeof CHANNELS[number] : null;
  const locale = body.locale === "ar" ? "ar" : "en";
  const subjectTemplate = text(body.subjectTemplate,500) || null;
  const bodyTemplate = text(body.bodyTemplate,20000);
  const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();

  if(!code || !eventType || !channel || !bodyTemplate || Number.isNaN(effectiveFrom.getTime())){
    return NextResponse.json({error:"missing_or_invalid_fields"},{status:400});
  }
  if(branchId && !canAccessBranch(session,branchId)) return NextResponse.json({error:"branch_forbidden"},{status:403});

  const created = await prisma.$transaction(async tx=>{
    const previous = await tx.notificationTemplate.findFirst({
      where:{organizationId:session.user.organizationId,branchId,code,channel,locale},
      orderBy:{version:"desc"},
    });
    if(previous && effectiveFrom <= previous.effectiveFrom){
      throw new Error("EFFECTIVE_FROM_MUST_ADVANCE");
    }
    if(previous && previous.status === "ACTIVE" && (!previous.effectiveTo || previous.effectiveTo >= effectiveFrom)){
      await tx.notificationTemplate.update({
        where:{id:previous.id},
        data:{effectiveTo:new Date(effectiveFrom.getTime()-1),status:"INACTIVE",deactivatedAt:effectiveFrom},
      });
    }
    const template = await tx.notificationTemplate.create({
      data:{
        organizationId:session.user.organizationId,branchId,code,eventType,channel,locale,
        version:(previous?.version||0)+1,subjectTemplate,bodyTemplate,effectiveFrom,
        createdByUserId:session.user.id,
      },
    });
    await tx.auditEvent.create({
      data:{
        organizationId:session.user.organizationId,branchId,actorUserId:session.user.id,
        action:"NOTIFICATION_TEMPLATE_VERSION_CREATED",entityType:"NotificationTemplate",entityId:template.id,
        newValues:{code,eventType,channel,locale,version:template.version,effectiveFrom},
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      },
    });
    return template;
  }).catch(error=>{
    if(error instanceof Error && error.message==="EFFECTIVE_FROM_MUST_ADVANCE") return null;
    throw error;
  });
  if(!created) return NextResponse.json({error:"effective_from_must_advance"},{status:409});
  return NextResponse.json({status:"ok",template:created},{status:201});
}
