import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authorizedBranchIds, canManageBranch, inputText, validCode } from "@/lib/branch-administration";

const error=(message:string,status:number)=>NextResponse.json({error:message},{status});

async function eligibleDepartment(tx: Prisma.TransactionClient, org:string, branchId:string, departmentId:string|null) {
  if(!departmentId) return true;
  return !!await tx.department.findFirst({where:{id:departmentId,organizationId:org,status:"ACTIVE",
    OR:[{branchId:null},{branchId}]}});
}

export async function GET() {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.view")&&!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const org=session.user.organizationId, allowed=authorizedBranchIds(session);
  const workstations=await prisma.workstation.findMany({
    where:{branch:{organizationId:org},branchId:{in:allowed}},
    select:{id:true,code:true,nameEn:true,nameAr:true,status:true,branchId:true,departmentId:true,updatedAt:true},
    orderBy:[{branchId:"asc"},{code:"asc"}],take:1000,
  });
  return NextResponse.json({workstations},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request) {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return error("invalid_request",400);
  const data=raw as Record<string,unknown>;
  const org=session.user.organizationId;
  const branchId=typeof data.branchId==="string"?data.branchId:"";
  const departmentId=data.departmentId===null||data.departmentId===""?null:typeof data.departmentId==="string"?data.departmentId:"";
  const code=validCode(data.code),nameEn=inputText(data.nameEn,150,true),nameAr=inputText(data.nameAr,150);
  if(!/^[0-9a-f-]{36}$/i.test(branchId)||(departmentId!==null&&!/^[0-9a-f-]{36}$/i.test(departmentId))||!code||!nameEn||nameAr===null)
    return error("invalid_workstation_fields",400);
  if(!canManageBranch(session,branchId)) return error("branch_forbidden",403);
  const ctx=await requestContext();
  try{
    const station=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM branches WHERE id=${branchId} AND organization_id=${org} FOR UPDATE`;
      const branch=await tx.branch.findFirst({where:{id:branchId,organizationId:org,status:"ACTIVE"}});
      if(!branch) throw Error("inactive_or_foreign_branch");
      const actor=await tx.user.findFirst({where:{id:session.userId,organizationId:org,status:"ACTIVE"}});
      const membership=await tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.userId,branchId}}});
      const sys=await tx.userRole.findFirst({where:{userId:session.userId,role:{organizationId:org,code:"SYSTEM_ADMIN",isSystem:true,status:"ACTIVE"}}});
      if(!actor||(!membership&&!sys)) throw Error("scope_revoked");
      if(!await eligibleDepartment(tx,org,branchId,departmentId)) throw Error("department_not_eligible_for_branch");
      const s=await tx.workstation.create({data:{branchId,departmentId,code,nameEn,nameAr:nameAr||null}});
      await tx.auditEvent.create({data:{organizationId:org,branchId,actorUserId:session.userId,
        action:"WORKSTATION_CREATED",entityType:"Workstation",entityId:s.id,
        newValues:{code,nameEn,nameAr:nameAr||null,departmentId},
        reason:"Branch workstation created",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
      return s;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({status:"ok",workstationId:station.id},{status:201});
  }catch(e){return error(e instanceof Error?e.message:"workstation_create_conflict",409);}
}

export async function PATCH(request:Request) {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return error("invalid_request",400);
  const data=raw as Record<string,unknown>;
  const id=typeof data.id==="string"?data.id:"";
  if(!/^[0-9a-f-]{36}$/i.test(id)) return error("invalid_workstation",400);
  if(data.code!==undefined||data.branchId!==undefined) return error("workstation_code_and_branch_immutable",400);
  const operation=data.operation;
  if(!["update","deactivate","reactivate"].includes(String(operation))) return error("invalid_operation",400);
  const nameEn=operation==="update"?inputText(data.nameEn,150,true):null;
  const nameAr=operation==="update"?inputText(data.nameAr,150):null;
  const departmentId=data.departmentId===null||data.departmentId===""?null:typeof data.departmentId==="string"?data.departmentId:"";
  if(operation==="update"&&(!nameEn||nameAr===null||(departmentId!==null&&!/^[0-9a-f-]{36}$/i.test(departmentId))))
    return error("invalid_workstation_fields",400);
  const reason=operation==="deactivate"?inputText(data.reason,1000,true):"";
  if(operation==="deactivate"&&(!reason||reason.length<15)) return error("documented_deactivation_reason_required",400);
  const org=session.user.organizationId,ctx=await requestContext();
  try{
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT w.id FROM workstations w INNER JOIN branches b ON b.id=w.branch_id WHERE w.id=${id} AND b.organization_id=${org} FOR UPDATE`;
      const station=await tx.workstation.findFirst({where:{id,branch:{organizationId:org}}});
      if(!station||!canManageBranch(session,station.branchId)) throw Error("workstation_not_authorized");
      const branch=await tx.branch.findFirst({where:{id:station.branchId,organizationId:org,status:"ACTIVE"}});
      if(!branch) throw Error("branch_inactive");
      const actor=await tx.user.findFirst({where:{id:session.userId,organizationId:org,status:"ACTIVE"}});
      const member=await tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.userId,branchId:station.branchId}}});
      const sys=await tx.userRole.findFirst({where:{userId:session.userId,role:{organizationId:org,code:"SYSTEM_ADMIN",isSystem:true,status:"ACTIVE"}}});
      if(!actor||(!member&&!sys)) throw Error("scope_revoked");
      if(operation==="update"){
        if(station.status!=="ACTIVE") throw Error("inactive_workstation");
        if(!await eligibleDepartment(tx,org,station.branchId,departmentId)) throw Error("department_not_eligible_for_branch");
      }else if(operation==="deactivate"&&station.status!=="ACTIVE") throw Error("workstation_not_active");
      else if(operation==="reactivate"&&station.status!=="INACTIVE") throw Error("workstation_not_inactive");
      const nextStatus=operation==="deactivate"?"INACTIVE":"ACTIVE";
      await tx.workstation.update({where:{id},data:operation==="update"?
        {nameEn:nameEn!,nameAr:nameAr||null,departmentId}:
        {status:nextStatus,deactivatedAt:nextStatus==="INACTIVE"?new Date():null}});
      await tx.auditEvent.create({data:{organizationId:org,branchId:station.branchId,actorUserId:session.userId,
        action:operation==="update"?"WORKSTATION_UPDATED":operation==="deactivate"?"WORKSTATION_DEACTIVATED":"WORKSTATION_REACTIVATED",
        entityType:"Workstation",entityId:id,
        oldValues:{nameEn:station.nameEn,nameAr:station.nameAr,departmentId:station.departmentId,status:station.status},
        newValues:operation==="update"?{nameEn,nameAr:nameAr||null,departmentId,status:station.status}:{status:nextStatus},
        reason:reason||"Workstation master data update",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({status:"ok"});
  }catch(e){return error(e instanceof Error?e.message:"workstation_update_conflict",409);}
}
