import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown,max=5000){return typeof value==="string"?value.trim().slice(0,max):"";}

export async function POST(request:Request){
  const session=await requirePermission("resilience.manage");
  const ctx=await requestContext();
  const body=await request.json().catch(()=>null);
  if(!body) return NextResponse.json({error:"invalid_request"},{status:400});
  const branchId=text(body.branchId,36)||null;
  const title=text(body.title,255);
  const status=["PLANNED","IN_PROGRESS","PASSED","FAILED","CANCELLED"].includes(body.status)?body.status:"PLANNED";
  const targetRpoMinutes=Number(body.targetRpoMinutes);
  const targetRtoMinutes=Number(body.targetRtoMinutes);
  const actualRpoMinutes=body.actualRpoMinutes===""||body.actualRpoMinutes==null?null:Number(body.actualRpoMinutes);
  const actualRtoMinutes=body.actualRtoMinutes===""||body.actualRtoMinutes==null?null:Number(body.actualRtoMinutes);
  const scheduledAt=new Date(String(body.scheduledAt||""));
  const completedAt=body.completedAt?new Date(String(body.completedAt)):null;
  const evidenceReference=text(body.evidenceReference,1000)||null;
  const findings=text(body.findings)||null;
  const correctiveActions=text(body.correctiveActions)||null;
  if(!title||!Number.isInteger(targetRpoMinutes)||targetRpoMinutes<0||!Number.isInteger(targetRtoMinutes)||targetRtoMinutes<0||Number.isNaN(scheduledAt.getTime())) return NextResponse.json({error:"invalid_drill"},{status:400});
  if(actualRpoMinutes!==null&&(!Number.isInteger(actualRpoMinutes)||actualRpoMinutes<0)) return NextResponse.json({error:"invalid_actual_rpo"},{status:400});
  if(actualRtoMinutes!==null&&(!Number.isInteger(actualRtoMinutes)||actualRtoMinutes<0)) return NextResponse.json({error:"invalid_actual_rto"},{status:400});
  if(completedAt && (Number.isNaN(completedAt.getTime()) || completedAt<scheduledAt || completedAt.getTime()>Date.now())) {
    return NextResponse.json({error:"invalid_drill_completion_time"},{status:400});
  }
  if(["PASSED","FAILED"].includes(status)&&(!completedAt||actualRpoMinutes===null||actualRtoMinutes===null||!evidenceReference)) {
    return NextResponse.json({error:"completed_drill_requires_actual_rpo_rto_and_evidence"},{status:409});
  }
  if(status==="PASSED" && (actualRpoMinutes!>targetRpoMinutes||actualRtoMinutes!>targetRtoMinutes)) {
    return NextResponse.json({error:"drill_targets_not_met"},{status:409});
  }
  if(branchId&&!canAccessBranch(session,branchId)) return NextResponse.json({error:"branch_forbidden"},{status:403});

  const drill=await prisma.$transaction(async tx=>{
    const created=await tx.disasterRecoveryDrill.create({data:{
      organizationId:session.user.organizationId,branchId,title,status,targetRpoMinutes,targetRtoMinutes,
      actualRpoMinutes,actualRtoMinutes,scheduledAt,
      startedAt:status==="IN_PROGRESS"?new Date():null,completedAt,
      ownerUserId:session.user.id,recordedByUserId:session.user.id,evidenceReference,findings,correctiveActions,
    }});
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId,branchId:branchId||session.activeBranchId,actorUserId:session.user.id,
      action:"DISASTER_RECOVERY_DRILL_RECORDED",entityType:"DisasterRecoveryDrill",entityId:created.id,
      newValues:{title,status,targetRpoMinutes,targetRtoMinutes,actualRpoMinutes,actualRtoMinutes,scheduledAt,completedAt,evidenceReference},
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return created;
  });
  return NextResponse.json({status:"ok",drill},{status:201});
}
